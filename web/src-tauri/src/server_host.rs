use std::fs;
use std::net::{IpAddr, TcpStream, UdpSocket};
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime, State};

const DEFAULT_PORT: u16 = 43110;

struct ServerProcess {
    child: Child,
    port: u16,
    setup_token: String,
}

#[derive(Default)]
pub struct ServerState(Mutex<Option<ServerProcess>>);

#[derive(Serialize)]
pub struct DesktopServerStatus {
    pub available: bool,
    pub running: bool,
    pub url: Option<String>,
    pub urls: Vec<String>,
    pub lan_urls: Vec<String>,
    pub share_url: Option<String>,
    pub setup_url: Option<String>,
    pub setup_token: Option<String>,
    pub port: u16,
    pub detail: String,
    pub server_entry: Option<String>,
    pub web_dist: Option<String>,
}

impl ServerState {
    fn prune_exited(&self) {
        if let Ok(mut guard) = self.0.lock() {
            let exited = match guard.as_mut() {
                Some(process) => process.child.try_wait().ok().flatten().is_some(),
                None => false,
            };
            if exited {
                *guard = None;
            }
        }
    }
}

impl Drop for ServerProcess {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn configured_port() -> u16 {
    std::env::var("DEBRIDSTREAMER_DESKTOP_SERVER_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .filter(|port| *port > 0)
        .unwrap_or(DEFAULT_PORT)
}

fn repo_root() -> Option<PathBuf> {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .map(Path::to_path_buf)
}

fn resource_server_dirs<R: Runtime>(app: &AppHandle<R>) -> Vec<PathBuf> {
    app.path()
        .resource_dir()
        .map(|resource_dir| {
            vec![
                resource_dir.join("server"),
                resource_dir.join("resources").join("server"),
            ]
        })
        .unwrap_or_default()
}

fn server_entry_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    if let Ok(path) = std::env::var("DEBRIDSTREAMER_SERVER_ENTRY") {
        let candidate = PathBuf::from(path);
        if candidate.is_file() {
            return Some(candidate);
        }
    }

    for server_dir in resource_server_dirs(app) {
        let candidate = server_dir.join("index.cjs");
        if candidate.is_file() {
            return Some(candidate);
        }
    }

    let candidate = repo_root()?.join("server").join("dist").join("index.cjs");
    candidate.is_file().then_some(candidate)
}

fn web_dist_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    if let Ok(path) = std::env::var("DEBRIDSTREAMER_WEB_DIST") {
        let candidate = PathBuf::from(path);
        if candidate.join("index.html").is_file() {
            return Some(candidate);
        }
    }

    for server_dir in resource_server_dirs(app) {
        let candidate = server_dir.join("web-dist");
        if candidate.join("index.html").is_file() {
            return Some(candidate);
        }
    }

    let candidate = repo_root()?.join("web").join("dist");
    candidate.join("index.html").is_file().then_some(candidate)
}

fn configured_node_path() -> Option<PathBuf> {
    if let Ok(path) = std::env::var("DEBRIDSTREAMER_NODE_BIN") {
        let candidate = PathBuf::from(path);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

fn node_runtime_layout() -> Option<(&'static str, &'static [&'static str], &'static str)> {
    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;

    match (os, arch) {
        ("macos", "aarch64") => Some((
            "darwin-arm64",
            &["darwin-arm64", "bin", "node"],
            "node",
        )),
        ("macos", "x86_64") => Some(("darwin-x64", &["darwin-x64", "bin", "node"], "node")),
        ("linux", "x86_64") => Some(("linux-x64", &["linux-x64", "bin", "node"], "node")),
        ("linux", "aarch64") => Some(("linux-arm64", &["linux-arm64", "bin", "node"], "node")),
        ("windows", "x86_64") => Some((
            "win-x64",
            &["win-x64", "node.exe"],
            "node.exe",
        )),
        ("windows", "aarch64") => Some((
            "win-arm64",
            &["win-arm64", "node.exe"],
            "node.exe",
        )),
        _ => None,
    }
}

fn bundled_node_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    let server_dirs = resource_server_dirs(app);
    let (_, relative, _) = node_runtime_layout()?;

    for server_dir in server_dirs {
        let base = server_dir.join("node");
        let candidate = relative.iter().fold(base, |path, segment| path.join(segment));
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

fn should_copy_node(source: &Path, dest: &Path) -> Result<bool, String> {
    let source_len = fs::metadata(source)
        .map_err(|e| format!("Failed to inspect bundled Node runtime: {e}"))?
        .len();
    Ok(match fs::metadata(dest) {
        Ok(metadata) => metadata.len() != source_len,
        Err(_) => true,
    })
}

fn materialized_node_path<R: Runtime>(
    app: &AppHandle<R>,
    bundled: &Path,
) -> Result<PathBuf, String> {
    let (runtime, _, exe_name) = node_runtime_layout()
        .ok_or_else(|| "This platform does not have a bundled Node runtime.".to_string())?;
    let dest_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("server")
        .join("node")
        .join(runtime);
    let dest = dest_dir.join(exe_name);

    if should_copy_node(bundled, &dest)? {
        fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;
        fs::copy(bundled, &dest)
            .map_err(|e| format!("Failed to materialize bundled Node runtime: {e}"))?;
    }

    #[cfg(unix)]
    {
        let mut permissions = fs::metadata(&dest).map_err(|e| e.to_string())?.permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&dest, permissions).map_err(|e| e.to_string())?;
    }

    Ok(dest)
}

fn node_command<R: Runtime>(app: &AppHandle<R>) -> Result<Command, String> {
    if let Some(path) = configured_node_path() {
        Ok(Command::new(path))
    } else if let Some(path) = bundled_node_path(app) {
        Ok(Command::new(materialized_node_path(app, &path)?))
    } else {
        Ok(Command::new("node"))
    }
}

fn local_url(port: u16) -> String {
    format!("http://127.0.0.1:{port}")
}

fn url_for_ip(ip: IpAddr, port: u16) -> String {
    match ip {
        IpAddr::V4(addr) => format!("http://{addr}:{port}"),
        IpAddr::V6(addr) => format!("http://[{addr}]:{port}"),
    }
}

fn detected_lan_urls(port: u16) -> Vec<String> {
    let socket = match UdpSocket::bind(("0.0.0.0", 0)) {
        Ok(socket) => socket,
        Err(_) => return Vec::new(),
    };
    if socket.connect(("8.8.8.8", 80)).is_err() {
        return Vec::new();
    }
    let ip = match socket.local_addr() {
        Ok(addr) => addr.ip(),
        Err(_) => return Vec::new(),
    };
    if ip.is_loopback() || ip.is_unspecified() {
        return Vec::new();
    }
    vec![url_for_ip(ip, port)]
}

fn configured_share_url() -> Option<String> {
    std::env::var("DEBRIDSTREAMER_DESKTOP_SHARE_URL")
        .ok()
        .map(|value| value.trim().trim_end_matches('/').to_string())
        .filter(|value| value.starts_with("http://") || value.starts_with("https://"))
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}

fn read_or_create_setup_token(data_dir: &Path) -> Result<String, String> {
    let path = data_dir.join("setup.token");
    if let Ok(value) = fs::read_to_string(&path) {
        let token = value.trim().to_string();
        if token.len() >= 32 {
            return Ok(token);
        }
    }

    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes)
        .map_err(|e| format!("Failed to generate desktop setup token: {e}"))?;
    let token = hex_encode(&bytes);
    fs::write(&path, format!("{token}\n"))
        .map_err(|e| format!("Failed to write desktop setup token: {e}"))?;

    #[cfg(unix)]
    {
        let mut permissions = fs::metadata(&path).map_err(|e| e.to_string())?.permissions();
        permissions.set_mode(0o600);
        fs::set_permissions(&path, permissions).map_err(|e| e.to_string())?;
    }

    Ok(token)
}

fn setup_url(base: &str, token: &str) -> String {
    let separator = if base.contains('?') { '&' } else { '?' };
    format!("{base}{separator}setup={token}")
}

fn server_urls(port: u16) -> (Vec<String>, Vec<String>, Option<String>) {
    let mut urls = vec![local_url(port)];
    let lan_urls = detected_lan_urls(port);
    for url in &lan_urls {
        if !urls.contains(url) {
            urls.push(url.clone());
        }
    }
    let share_url = configured_share_url();
    if let Some(url) = &share_url {
        if !urls.contains(url) {
            urls.push(url.clone());
        }
    }
    (urls, lan_urls, share_url)
}

fn port_is_open(port: u16) -> bool {
    TcpStream::connect(("127.0.0.1", port)).is_ok()
}

fn wait_for_port(port: u16) -> bool {
    let deadline = Instant::now() + Duration::from_secs(6);
    while Instant::now() < deadline {
        if port_is_open(port) {
            return true;
        }
        thread::sleep(Duration::from_millis(100));
    }
    false
}

fn status_for<R: Runtime>(
    app: &AppHandle<R>,
    state: &ServerState,
    detail: Option<String>,
) -> DesktopServerStatus {
    state.prune_exited();
    let port = configured_port();
    let running_process = state
        .0
        .lock()
        .ok()
        .and_then(|guard| guard.as_ref().map(|process| (process.port, process.setup_token.clone())));
    let running = running_process.is_some();
    let server_entry = server_entry_path(app);
    let web_dist = web_dist_path(app);
    let available = server_entry.is_some();
    let (urls, lan_urls, share_url) = if running {
        server_urls(port)
    } else {
        (Vec::new(), Vec::new(), configured_share_url())
    };
    let setup_token = running_process.map(|(_, token)| token);
    let setup_url = setup_token.as_ref().and_then(|token| {
        share_url
            .as_ref()
            .or_else(|| lan_urls.first())
            .or_else(|| urls.first())
            .map(|url| setup_url(url, token))
    });
    let detail = detail.unwrap_or_else(|| {
        if running {
            "Desktop server is running.".to_string()
        } else if available {
            "Desktop server bundle is available.".to_string()
        } else {
            "Server bundle was not found. Build server/dist/index.cjs first or package resources/server/index.cjs.".to_string()
        }
    });

    DesktopServerStatus {
        available,
        running,
        url: running.then(|| local_url(port)),
        urls,
        lan_urls,
        share_url,
        setup_url,
        setup_token,
        port,
        detail,
        server_entry: server_entry.map(|path| path.display().to_string()),
        web_dist: web_dist.map(|path| path.display().to_string()),
    }
}

#[tauri::command]
pub fn desktop_server_status<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, ServerState>,
) -> DesktopServerStatus {
    status_for(&app, &state, None)
}

#[tauri::command]
pub fn desktop_server_start<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, ServerState>,
) -> Result<DesktopServerStatus, String> {
    state.prune_exited();
    if state.0.lock().map_err(|e| e.to_string())?.is_some() {
        return Ok(status_for(&app, &state, None));
    }

    let port = configured_port();
    if port_is_open(port) {
        return Err(format!("Port {port} is already in use."));
    }

    let server_entry = server_entry_path(&app).ok_or_else(|| {
        "Server bundle was not found. Run `cd server && npm run build`, or package resources/server/index.cjs for releases.".to_string()
    })?;
    let web_dist = web_dist_path(&app);
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("server");
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    let setup_token = read_or_create_setup_token(&data_dir)?;

    let mut command = node_command(&app)?;
    command
        .arg(&server_entry)
        .env("NODE_ENV", "production")
        .env("HOST", "0.0.0.0")
        .env("PORT", port.to_string())
        .env("DS_SERVER_DATA_DIR", &data_dir)
        .env("DS_SERVER_DB_PATH", data_dir.join("debridstreamer.sqlite"))
        .env("DS_SERVER_SETUP_TOKEN", &setup_token)
        .env(
            "DS_SERVER_CORS_ORIGIN",
            "http://tauri.localhost,tauri://localhost,http://localhost:5173,http://127.0.0.1:5173",
        )
        .env("DS_SERVER_COOKIE_SECURE", "false")
        .env("DS_SERVER_COOKIE_SAMESITE", "lax")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    if let Some(web_dist) = &web_dist {
        command.env("DS_WEB_DIST", web_dist);
    }

    let child = command
        .spawn()
        .map_err(|e| format!("Failed to start bundled server with Node: {e}"))?;

    {
        let mut guard = state.0.lock().map_err(|e| e.to_string())?;
        *guard = Some(ServerProcess {
            child,
            port,
            setup_token,
        });
    }

    if !wait_for_port(port) {
        let mut guard = state.0.lock().map_err(|e| e.to_string())?;
        *guard = None;
        return Err("Server process started but did not open its port.".to_string());
    }

    Ok(status_for(
        &app,
        &state,
        Some(format!("Desktop server started at {}.", local_url(port))),
    ))
}

#[tauri::command]
pub fn desktop_server_stop<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, ServerState>,
) -> Result<DesktopServerStatus, String> {
    {
        let mut guard = state.0.lock().map_err(|e| e.to_string())?;
        *guard = None;
    }
    Ok(status_for(
        &app,
        &state,
        Some("Desktop server stopped.".to_string()),
    ))
}
