use std::io::{Read, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use reqwest::header::{
    HeaderMap, ACCEPT_ENCODING, ACCEPT_RANGES, AUTHORIZATION, CONTENT_LENGTH, CONTENT_RANGE,
    CONTENT_TYPE, COOKIE, ETAG, LAST_MODIFIED, RANGE,
};
use reqwest::{Client, Method, Response, StatusCode};

use crate::playback_auth::AuthenticatedPlayback;

const MAX_REQUEST_HEADER_BYTES: usize = 16 * 1024;
const MAX_RANGE_BYTES: usize = 128;
const MAX_CONCURRENT_CONNECTIONS: usize = 8;
const DEFAULT_IDLE_TIMEOUT: Duration = Duration::from_secs(15 * 60);
const DEFAULT_MAX_LIFETIME: Duration = Duration::from_secs(6 * 60 * 60);
const DEFAULT_CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const DEFAULT_IO_TIMEOUT: Duration = Duration::from_secs(30);
const UPSTREAM_RETRY_DELAY: Duration = Duration::from_millis(200);

struct ProxyControl {
    cancelled: AtomicBool,
    active: AtomicUsize,
    started: Instant,
    last_activity: Mutex<Instant>,
    idle_timeout: Duration,
    max_lifetime: Duration,
}

/// Owns a single authenticated loopback handoff. Dropping it closes the
/// listener and cancels any transfer at its next streaming boundary.
pub(crate) struct ProxyLease {
    url: String,
    address: std::net::SocketAddr,
    control: Arc<ProxyControl>,
    server: Option<JoinHandle<()>>,
}

impl ProxyLease {
    pub(crate) fn url(&self) -> &str {
        &self.url
    }

    #[cfg(test)]
    fn is_finished(&self) -> bool {
        self.server.as_ref().is_none_or(JoinHandle::is_finished)
    }
}

impl Drop for ProxyLease {
    fn drop(&mut self) {
        self.control.cancelled.store(true, Ordering::Release);
        // Wake the nonblocking accept loop immediately instead of waiting for
        // its poll interval.
        if let Ok(stream) = TcpStream::connect_timeout(&self.address, Duration::from_millis(50)) {
            let _ = stream.shutdown(Shutdown::Both);
        }
        if let Some(server) = self.server.take() {
            // Retirement runs away from command and state-lock paths. All
            // transfer I/O has explicit timeouts, so this reaper is bounded.
            let _ = thread::Builder::new()
                .name("playback-proxy-reaper".to_string())
                .spawn(move || {
                    let _ = server.join();
                });
        }
    }
}

pub(crate) fn start(playback: AuthenticatedPlayback) -> Result<ProxyLease, String> {
    start_with_timeouts(playback, DEFAULT_IDLE_TIMEOUT, DEFAULT_MAX_LIFETIME)
}

fn start_with_timeouts(
    playback: AuthenticatedPlayback,
    idle_timeout: Duration,
    max_lifetime: Duration,
) -> Result<ProxyLease, String> {
    start_with_config(playback, idle_timeout, max_lifetime, DEFAULT_IO_TIMEOUT)
}

fn start_with_config(
    playback: AuthenticatedPlayback,
    idle_timeout: Duration,
    max_lifetime: Duration,
    io_timeout: Duration,
) -> Result<ProxyLease, String> {
    let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .map_err(|error| format!("failed to bind playback proxy: {error}"))?;
    listener
        .set_nonblocking(true)
        .map_err(|error| format!("failed to configure playback proxy: {error}"))?;
    let address = listener
        .local_addr()
        .map_err(|error| format!("failed to read playback proxy address: {error}"))?;

    let mut capability = [0_u8; 32];
    getrandom::getrandom(&mut capability)
        .map_err(|error| format!("failed to create playback capability: {error}"))?;
    let capability = capability
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let path = format!("/{capability}");
    let expected_host = format!("127.0.0.1:{}", address.port());
    let url = format!("http://{expected_host}{path}");

    let client = Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .no_proxy()
        .connect_timeout(DEFAULT_CONNECT_TIMEOUT)
        .read_timeout(io_timeout)
        .build()
        .map_err(|error| format!("failed to configure playback proxy client: {error}"))?;
    let control = Arc::new(ProxyControl {
        cancelled: AtomicBool::new(false),
        active: AtomicUsize::new(0),
        started: Instant::now(),
        last_activity: Mutex::new(Instant::now()),
        idle_timeout,
        max_lifetime,
    });
    let server_control = Arc::clone(&control);
    let playback = Arc::new(playback);
    let server = thread::Builder::new()
        .name("playback-proxy".to_string())
        .spawn(move || {
            let mut transfers: Vec<JoinHandle<()>> = Vec::new();
            loop {
                reap_finished(&mut transfers);
                if should_stop(&server_control) {
                    break;
                }
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        if server_control.cancelled.load(Ordering::Acquire) {
                            break;
                        }
                        // Accepted sockets can inherit O_NONBLOCK from the
                        // listener on macOS. Streaming writes must be blocking
                        // with an explicit timeout, not fail spuriously with
                        // EAGAIN under backpressure.
                        if stream.set_nonblocking(false).is_err() {
                            continue;
                        }
                        let _ = stream.set_write_timeout(Some(io_timeout));
                        if server_control.active.load(Ordering::Acquire)
                            >= MAX_CONCURRENT_CONNECTIONS
                        {
                            write_empty(&mut stream, 503);
                            continue;
                        }
                        server_control.active.fetch_add(1, Ordering::AcqRel);
                        let client = client.clone();
                        let playback = Arc::clone(&playback);
                        let control = Arc::clone(&server_control);
                        let path = path.clone();
                        let expected_host = expected_host.clone();
                        transfers.push(thread::spawn(move || {
                            handle_connection(
                                stream,
                                &client,
                                &playback,
                                &path,
                                &expected_host,
                                &control,
                                io_timeout,
                            );
                            if let Ok(mut last) = control.last_activity.lock() {
                                *last = Instant::now();
                            }
                            control.active.fetch_sub(1, Ordering::AcqRel);
                        }));
                    }
                    Err(error)
                        if matches!(
                            error.kind(),
                            std::io::ErrorKind::WouldBlock
                                | std::io::ErrorKind::Interrupted
                                | std::io::ErrorKind::ConnectionAborted
                        ) =>
                    {
                        thread::sleep(Duration::from_millis(20));
                    }
                    Err(_) => break,
                }
            }
            server_control.cancelled.store(true, Ordering::Release);
            for transfer in transfers {
                let _ = transfer.join();
            }
        })
        .map_err(|error| format!("failed to start playback proxy: {error}"))?;

    Ok(ProxyLease {
        url,
        address,
        control,
        server: Some(server),
    })
}

fn reap_finished(transfers: &mut Vec<JoinHandle<()>>) {
    let mut index = 0;
    while index < transfers.len() {
        if transfers[index].is_finished() {
            let transfer = transfers.swap_remove(index);
            let _ = transfer.join();
        } else {
            index += 1;
        }
    }
}

fn should_stop(control: &ProxyControl) -> bool {
    if control.cancelled.load(Ordering::Acquire) {
        return true;
    }
    if control.started.elapsed() >= control.max_lifetime {
        return true;
    }
    control.active.load(Ordering::Acquire) == 0
        && control
            .last_activity
            .lock()
            .map(|last| last.elapsed() >= control.idle_timeout)
            .unwrap_or(true)
}

struct ClientRequest {
    method: Method,
    range: Option<String>,
}

fn parse_request(
    stream: &mut TcpStream,
    path: &str,
    host: &str,
    io_timeout: Duration,
) -> Result<ClientRequest, u16> {
    let _ = stream.set_read_timeout(Some(io_timeout));
    let mut bytes = Vec::with_capacity(1024);
    let mut buffer = [0_u8; 1024];
    while !bytes.windows(4).any(|window| window == b"\r\n\r\n") {
        let read = stream.read(&mut buffer).map_err(|_| 400_u16)?;
        if read == 0 {
            return Err(400);
        }
        bytes.extend_from_slice(&buffer[..read]);
        if bytes.len() > MAX_REQUEST_HEADER_BYTES {
            return Err(431);
        }
    }
    let header_end = bytes
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .ok_or(400_u16)?;
    if header_end + 4 != bytes.len() {
        return Err(400);
    }
    let text = std::str::from_utf8(&bytes[..header_end]).map_err(|_| 400_u16)?;
    let mut lines = text.split("\r\n");
    let mut request_line = lines.next().ok_or(400_u16)?.split_ascii_whitespace();
    let method = match request_line.next() {
        Some("GET") => Method::GET,
        Some("HEAD") => Method::HEAD,
        _ => return Err(405),
    };
    if request_line.next() != Some(path)
        || !matches!(request_line.next(), Some("HTTP/1.0" | "HTTP/1.1"))
        || request_line.next().is_some()
    {
        return Err(404);
    }

    let mut request_host = None;
    let mut range = None;
    for line in lines {
        let (name, value) = line.split_once(':').ok_or(400_u16)?;
        let value = value.trim_matches([' ', '\t']);
        if name.eq_ignore_ascii_case("host") {
            if request_host.replace(value).is_some() {
                return Err(400);
            }
        } else if name.eq_ignore_ascii_case("range") {
            if range.is_some() || !valid_range(value) {
                return Err(400);
            }
            range = Some(value.to_string());
        }
    }
    if request_host != Some(host) {
        return Err(403);
    }
    Ok(ClientRequest { method, range })
}

fn valid_range(value: &str) -> bool {
    if value.len() > MAX_RANGE_BYTES {
        return false;
    }
    let Some(spec) = value.strip_prefix("bytes=") else {
        return false;
    };
    if spec.contains(',') {
        return false;
    }
    let Some((start, end)) = spec.split_once('-') else {
        return false;
    };
    if start.is_empty() && end.is_empty() {
        return false;
    }
    if !start.bytes().all(|byte| byte.is_ascii_digit())
        || !end.bytes().all(|byte| byte.is_ascii_digit())
    {
        return false;
    }
    match (start.parse::<u64>(), end.parse::<u64>()) {
        (Ok(start), Ok(end)) => start <= end,
        (Ok(_), Err(_)) if end.is_empty() => true,
        (Err(_), Ok(_)) if start.is_empty() => true,
        _ => false,
    }
}

fn handle_connection(
    mut stream: TcpStream,
    client: &Client,
    playback: &AuthenticatedPlayback,
    path: &str,
    host: &str,
    control: &ProxyControl,
    io_timeout: Duration,
) {
    let request = match parse_request(&mut stream, path, host, io_timeout) {
        Ok(request) => request,
        Err(status) => {
            write_empty(&mut stream, status);
            return;
        }
    };

    let runtime = match tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(_) => {
            write_empty(&mut stream, 502);
            return;
        }
    };
    runtime.block_on(forward_request(stream, client, playback, request, control));
}

async fn forward_request(
    mut stream: TcpStream,
    client: &Client,
    playback: &AuthenticatedPlayback,
    request: ClientRequest,
    control: &ProxyControl,
) {
    for attempt in 0..2 {
        let mut upstream = client
            .request(request.method.clone(), playback.target_url())
            .header(ACCEPT_ENCODING, "identity");
        if let Some(authorization) = playback.authorization() {
            upstream = upstream.header(AUTHORIZATION, authorization);
        }
        if let Some(cookie) = playback.cookie_header() {
            upstream = upstream.header(COOKIE, cookie);
        }
        if let Some(range) = request.range.as_deref() {
            upstream = upstream.header(RANGE, range);
        }

        match upstream.send().await {
            Ok(response) if attempt == 0 && retryable_upstream_status(response.status()) => {
                if !wait_for_retry(control).await {
                    return;
                }
            }
            Ok(response) => {
                relay_response(stream, request.method == Method::HEAD, response, control).await;
                return;
            }
            Err(_) if attempt == 0 => {
                if !wait_for_retry(control).await {
                    return;
                }
            }
            Err(_) => {
                write_empty(&mut stream, 502);
                return;
            }
        }
    }
}

fn retryable_upstream_status(status: StatusCode) -> bool {
    matches!(
        status,
        StatusCode::BAD_GATEWAY | StatusCode::SERVICE_UNAVAILABLE | StatusCode::GATEWAY_TIMEOUT
    )
}

async fn wait_for_retry(control: &ProxyControl) -> bool {
    let deadline = Instant::now() + UPSTREAM_RETRY_DELAY;
    loop {
        if control.cancelled.load(Ordering::Acquire)
            || control.started.elapsed() >= control.max_lifetime
        {
            return false;
        }
        let now = Instant::now();
        if now >= deadline {
            return true;
        }
        tokio::time::sleep((deadline - now).min(Duration::from_millis(25))).await;
    }
}

async fn relay_response(
    mut downstream: TcpStream,
    head: bool,
    upstream: Response,
    control: &ProxyControl,
) {
    let status = upstream.status();
    if !matches!(
        status,
        StatusCode::OK | StatusCode::PARTIAL_CONTENT | StatusCode::RANGE_NOT_SATISFIABLE
    ) {
        write_empty(&mut downstream, 502);
        return;
    }
    let include_body = !head && status != StatusCode::RANGE_NOT_SATISFIABLE;
    let mut response = format!(
        "HTTP/1.1 {} {}\r\nConnection: close\r\n",
        status.as_u16(),
        status.canonical_reason().unwrap_or("Response")
    );
    append_allowed_headers(
        &mut response,
        upstream.headers(),
        include_body || (head && status != StatusCode::RANGE_NOT_SATISFIABLE),
    );
    if !include_body && !head {
        response.push_str("Content-Length: 0\r\n");
    }
    response.push_str("\r\n");
    if downstream.write_all(response.as_bytes()).is_err() || !include_body {
        return;
    }
    let mut body = upstream.bytes_stream();
    while !control.cancelled.load(Ordering::Acquire) {
        match body.next().await {
            Some(Ok(bytes)) if downstream.write_all(&bytes).is_err() => break,
            Some(Ok(_)) => {}
            Some(Err(_)) | None => break,
        }
    }
}

fn append_allowed_headers(output: &mut String, headers: &HeaderMap, include_length: bool) {
    for name in [
        ACCEPT_RANGES,
        CONTENT_RANGE,
        CONTENT_TYPE,
        ETAG,
        LAST_MODIFIED,
    ] {
        if let Some(value) = headers.get(&name).and_then(|value| value.to_str().ok()) {
            output.push_str(name.as_str());
            output.push_str(": ");
            output.push_str(value);
            output.push_str("\r\n");
        }
    }
    if include_length {
        if let Some(value) = headers
            .get(CONTENT_LENGTH)
            .and_then(|value| value.to_str().ok())
        {
            output.push_str("content-length: ");
            output.push_str(value);
            output.push_str("\r\n");
        }
    }
}

fn write_empty(stream: &mut TcpStream, status: u16) {
    let reason = match status {
        400 => "Bad Request",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        431 => "Request Header Fields Too Large",
        503 => "Service Unavailable",
        _ => "Bad Gateway",
    };
    let _ = write!(
        stream,
        "HTTP/1.1 {status} {reason}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
    );
}

#[derive(Default)]
pub(crate) struct ExternalPlaybackState(pub Mutex<Option<ProxyLease>>);

impl ExternalPlaybackState {
    pub(crate) fn set(&self, lease: Option<ProxyLease>) {
        let previous = {
            let mut current = self
                .0
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            std::mem::replace(&mut *current, lease)
        };
        drop(previous);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    fn playback(url: String) -> AuthenticatedPlayback {
        AuthenticatedPlayback::test_bearer(url)
    }

    fn upstream_once(response: Vec<u8>) -> (String, mpsc::Receiver<String>, JoinHandle<()>) {
        let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let (sender, receiver) = mpsc::channel();
        let thread = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut bytes = Vec::new();
            let mut part = [0_u8; 1024];
            while !bytes.windows(4).any(|window| window == b"\r\n\r\n") {
                let read = stream.read(&mut part).unwrap();
                bytes.extend_from_slice(&part[..read]);
            }
            sender.send(String::from_utf8(bytes).unwrap()).unwrap();
            stream.write_all(&response).unwrap();
        });
        (format!("http://{address}/media"), receiver, thread)
    }

    fn request(url: &str, raw_headers: &str) -> Vec<u8> {
        let parsed = tauri::Url::parse(url).unwrap();
        let address = format!("{}:{}", parsed.host_str().unwrap(), parsed.port().unwrap());
        let mut stream = TcpStream::connect(&address).unwrap();
        write!(
            stream,
            "GET {} HTTP/1.1\r\nHost: {address}\r\n{raw_headers}\r\n",
            parsed.path()
        )
        .unwrap();
        let mut response = Vec::new();
        stream.read_to_end(&mut response).unwrap();
        response
    }

    #[test]
    fn injects_frozen_credentials_and_blocks_client_overrides() {
        let (upstream_url, captured, upstream) = upstream_once(
            b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nContent-Type: video/mp4\r\nSet-Cookie: leak=yes\r\nAccess-Control-Allow-Origin: *\r\n\r\nok".to_vec(),
        );
        let lease = start(playback(upstream_url)).unwrap();
        let response = request(
            lease.url(),
            "Authorization: Bearer attacker\r\nCookie: ds_session=attacker\r\nRange: bytes=0-1\r\n",
        );
        let captured = captured.recv_timeout(Duration::from_secs(2)).unwrap();
        assert!(captured.contains("authorization: Bearer AAAAAAAAA"));
        assert!(captured.contains("cookie: CF_Session=test"));
        assert!(captured.contains("range: bytes=0-1"));
        assert!(captured.contains("accept-encoding: identity"));
        assert!(!captured.contains("attacker"));
        let response = String::from_utf8(response).unwrap();
        assert!(response.starts_with("HTTP/1.1 200"));
        assert!(response.ends_with("ok"));
        assert!(!response.to_ascii_lowercase().contains("set-cookie"));
        assert!(!response.to_ascii_lowercase().contains("access-control"));
        drop(lease);
        upstream.join().unwrap();
    }

    #[test]
    fn legacy_session_injects_frozen_cookie_without_authorization() {
        let (upstream_url, captured, upstream) =
            upstream_once(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok".to_vec());
        let playback = AuthenticatedPlayback::test_legacy(
            upstream_url,
            "ds_session=sess_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
                .to_string(),
        );
        let lease = start(playback).unwrap();
        let response = request(
            lease.url(),
            "Authorization: Bearer attacker\r\nCookie: ds_session=attacker\r\n",
        );
        let captured = captured.recv_timeout(Duration::from_secs(2)).unwrap();
        assert!(!captured.to_ascii_lowercase().contains("authorization:"));
        assert!(captured.contains("cookie: ds_session=sess_aaaaaaaa"));
        assert!(!captured.contains("attacker"));
        assert!(response.ends_with(b"ok"));
        drop(lease);
        upstream.join().unwrap();
    }

    #[test]
    fn retries_one_transient_status_with_identical_frozen_request() {
        let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let (captured_tx, captured_rx) = mpsc::channel();
        let upstream = thread::spawn(move || {
            for response in [
                b"HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                    .as_slice(),
                b"HTTP/1.1 206 Partial Content\r\nContent-Length: 2\r\nContent-Range: bytes 0-1/2\r\nConnection: close\r\n\r\nok"
                    .as_slice(),
            ] {
                let (mut stream, _) = listener.accept().unwrap();
                let mut bytes = Vec::new();
                let mut part = [0_u8; 1024];
                while !bytes.windows(4).any(|window| window == b"\r\n\r\n") {
                    let read = stream.read(&mut part).unwrap();
                    bytes.extend_from_slice(&part[..read]);
                }
                captured_tx.send(String::from_utf8(bytes).unwrap()).unwrap();
                stream.write_all(response).unwrap();
            }
        });
        let lease = start(playback(format!("http://{address}/media"))).unwrap();
        let response = request(
            lease.url(),
            "Authorization: Bearer attacker\r\nCookie: ds_session=attacker\r\nRange: bytes=0-1\r\n",
        );
        let first = captured_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        let second = captured_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        for captured in [&first, &second] {
            assert!(captured.contains("authorization: Bearer AAAAAAAAA"));
            assert!(captured.contains("cookie: CF_Session=test"));
            assert!(captured.contains("range: bytes=0-1"));
            assert!(!captured.contains("attacker"));
        }
        assert_eq!(first, second);
        assert!(response.starts_with(b"HTTP/1.1 206"));
        assert!(response.ends_with(b"ok"));
        drop(lease);
        upstream.join().unwrap();
    }

    #[test]
    fn rejects_wrong_path_query_host_method_and_invalid_range() {
        let (upstream_url, _captured, _upstream) = upstream_once(Vec::new());
        let lease = start(playback(upstream_url)).unwrap();
        let parsed = tauri::Url::parse(lease.url()).unwrap();
        let address = format!("{}:{}", parsed.host_str().unwrap(), parsed.port().unwrap());
        for request in [
            format!("GET /wrong HTTP/1.1\r\nHost: {address}\r\n\r\n"),
            format!(
                "GET {}?q=1 HTTP/1.1\r\nHost: {address}\r\n\r\n",
                parsed.path()
            ),
            format!("GET {} HTTP/1.1\r\nHost: localhost\r\n\r\n", parsed.path()),
            format!("POST {} HTTP/1.1\r\nHost: {address}\r\n\r\n", parsed.path()),
            format!(
                "GET {} HTTP/1.1\r\nHost: {address}\r\nRange: bytes=1-0\r\n\r\n",
                parsed.path()
            ),
        ] {
            let mut stream = TcpStream::connect(&address).unwrap();
            stream.write_all(request.as_bytes()).unwrap();
            let mut response = String::new();
            stream.read_to_string(&mut response).unwrap();
            assert!(!response.starts_with("HTTP/1.1 200"), "{request}");
        }
        drop(lease);
    }

    #[test]
    fn redirects_are_not_followed_and_location_is_never_relayed() {
        let second = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).unwrap();
        second.set_nonblocking(true).unwrap();
        let location = format!("http://{}/secret", second.local_addr().unwrap());
        let response =
            format!("HTTP/1.1 302 Found\r\nLocation: {location}\r\nContent-Length: 5\r\n\r\nlogin");
        let (url, _captured, upstream) = upstream_once(response.into_bytes());
        let lease = start(playback(url)).unwrap();
        let response = String::from_utf8(request(lease.url(), "")).unwrap();
        assert!(response.starts_with("HTTP/1.1 502"));
        assert!(!response.contains("Location"));
        assert!(!response.contains("login"));
        thread::sleep(Duration::from_millis(50));
        assert!(second.accept().is_err());
        drop(lease);
        upstream.join().unwrap();
    }

    #[test]
    fn head_and_range_statuses_keep_only_media_headers() {
        for (method, status, headers) in [
            ("HEAD", "200 OK", "Content-Length: 20\r\nAccept-Ranges: bytes\r\nETag: test\r\nWWW-Authenticate: secret\r\n"),
            ("GET", "206 Partial Content", "Content-Length: 2\r\nContent-Range: bytes 0-1/20\r\n"),
            ("GET", "416 Range Not Satisfiable", "Content-Range: bytes */20\r\n"),
        ] {
            let (url, _captured, upstream) = upstream_once(
                format!("HTTP/1.1 {status}\r\n{headers}\r\nok").into_bytes(),
            );
            let lease = start(playback(url)).unwrap();
            let parsed = tauri::Url::parse(lease.url()).unwrap();
            let address = format!("{}:{}", parsed.host_str().unwrap(), parsed.port().unwrap());
            let mut stream = TcpStream::connect(&address).unwrap();
            write!(stream, "{method} {} HTTP/1.1\r\nHost: {address}\r\nRange: bytes=0-1\r\n\r\n", parsed.path()).unwrap();
            let mut response = String::new();
            stream.read_to_string(&mut response).unwrap();
            assert!(response.starts_with(&format!("HTTP/1.1 {}", &status[..3])));
            assert!(!response.to_ascii_lowercase().contains("www-authenticate"));
            if method == "HEAD" || status.starts_with("416") {
                assert!(!response.ends_with("ok"));
            }
            drop(lease);
            upstream.join().unwrap();
        }
    }

    #[test]
    fn rejects_connections_above_the_concurrency_cap_without_spawning() {
        let lease = start_with_config(
            playback("http://127.0.0.1:9/media".to_string()),
            Duration::from_secs(5),
            Duration::from_secs(5),
            // Keep the deliberately idle held sockets alive while the excess
            // connection reaches the accept loop. A short timeout races the
            // assertion on loaded CI runners and can admit the excess socket
            // after one holder retires.
            Duration::from_secs(5),
        )
        .unwrap();
        let parsed = tauri::Url::parse(lease.url()).unwrap();
        let address = format!("{}:{}", parsed.host_str().unwrap(), parsed.port().unwrap());
        let held: Vec<TcpStream> = (0..MAX_CONCURRENT_CONNECTIONS)
            .map(|_| TcpStream::connect(&address).unwrap())
            .collect();
        let deadline = Instant::now() + Duration::from_secs(2);
        while lease.control.active.load(Ordering::Acquire) < MAX_CONCURRENT_CONNECTIONS {
            assert!(Instant::now() < deadline, "connections were not accepted");
            thread::sleep(Duration::from_millis(10));
        }

        let mut excess = TcpStream::connect(&address).unwrap();
        excess
            .set_read_timeout(Some(Duration::from_secs(1)))
            .unwrap();
        let mut response = String::new();
        excess.read_to_string(&mut response).unwrap();
        assert!(response.starts_with("HTTP/1.1 503"));
        assert_eq!(
            lease.control.active.load(Ordering::Acquire),
            MAX_CONCURRENT_CONNECTIONS
        );
        drop(held);
        drop(lease);
    }

    #[test]
    fn stalled_upstream_retirement_does_not_block_lease_drop() {
        let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let (request_seen_tx, request_seen_rx) = mpsc::channel();
        let (closed_tx, closed_rx) = mpsc::channel();
        let upstream = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut bytes = Vec::new();
            let mut part = [0_u8; 1024];
            while !bytes.windows(4).any(|window| window == b"\r\n\r\n") {
                let read = stream.read(&mut part).unwrap();
                bytes.extend_from_slice(&part[..read]);
            }
            request_seen_tx.send(()).unwrap();
            let mut rest = Vec::new();
            let _ = stream.read_to_end(&mut rest);
            closed_tx.send(()).unwrap();
        });
        let lease = start_with_config(
            playback(format!("http://{address}/media")),
            Duration::from_secs(5),
            Duration::from_secs(5),
            Duration::from_millis(100),
        )
        .unwrap();
        let proxy_url = lease.url().to_string();
        let downstream = thread::spawn(move || request(&proxy_url, ""));
        request_seen_rx
            .recv_timeout(Duration::from_secs(2))
            .unwrap();

        let started = Instant::now();
        drop(lease);
        assert!(
            started.elapsed() < Duration::from_millis(100),
            "lease drop synchronously waited for stalled I/O"
        );
        closed_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        let _ = downstream.join();
        upstream.join().unwrap();
    }

    #[test]
    fn streams_a_large_body_and_lease_drop_or_idle_expiry_stops_threads() {
        let body = vec![b'x'; 2 * 1024 * 1024];
        let mut response =
            format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n", body.len()).into_bytes();
        response.extend_from_slice(&body);
        let (url, _captured, upstream) = upstream_once(response);
        let lease = start(playback(url)).unwrap();
        let response = request(lease.url(), "");
        assert_eq!(
            response.iter().filter(|byte| **byte == b'x').count(),
            body.len()
        );
        drop(lease);
        upstream.join().unwrap();

        let lease = start_with_timeouts(
            // No downstream request is made, so the upstream address is never
            // contacted. Use a closed local port instead of leaking an accept
            // thread that cannot be joined.
            playback("http://127.0.0.1:9/media".to_string()),
            Duration::from_millis(30),
            Duration::from_secs(1),
        )
        .unwrap();
        let deadline = Instant::now() + Duration::from_secs(2);
        while !lease.is_finished() {
            assert!(Instant::now() < deadline, "idle proxy did not retire");
            thread::sleep(Duration::from_millis(10));
        }
    }
}
