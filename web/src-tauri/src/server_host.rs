use std::fs;
use std::io::Write;
use std::net::{IpAddr, TcpStream, UdpSocket};
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime, State};

const DEFAULT_PORT: u16 = 43110;
const SERVER_LOG_MAX_BYTES: u64 = 1024 * 1024;
const SERVER_MONITOR_INTERVAL: Duration = Duration::from_millis(250);
const SERVER_MAX_RESPAWN_ATTEMPTS: usize = 5;
const SERVER_MAX_BACKOFF: Duration = Duration::from_secs(4);

struct ServerProcess {
    child: Child,
    port: u16,
    setup_token: String,
    generation: u64,
}

#[derive(Default)]
pub struct ServerState {
    process: Arc<Mutex<Option<ServerProcess>>>,
    desired_generation: Arc<AtomicU64>,
    next_generation: AtomicU64,
    monitor: Mutex<Option<JoinHandle<()>>>,
}

#[derive(Clone)]
struct ServerLaunch {
    node_path: PathBuf,
    server_entry: PathBuf,
    web_dist: Option<PathBuf>,
    data_dir: PathBuf,
    setup_token: String,
    port: u16,
    log_path: PathBuf,
}

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
    fn generation(&self) -> u64 {
        self.next_generation.fetch_add(1, Ordering::Relaxed) + 1
    }

    fn prune_exited(&self) {
        if let Ok(mut guard) = self.process.lock() {
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

impl Drop for ServerState {
    fn drop(&mut self) {
        self.desired_generation.store(0, Ordering::Release);
        if let Ok(mut guard) = self.process.lock() {
            *guard = None;
        }
        if let Ok(mut monitor) = self.monitor.lock() {
            if let Some(handle) = monitor.take() {
                let _ = handle.join();
            }
        }
    }
}

fn append_server_log(path: &Path, source: &str, message: &str) {
    eprintln!("desktop server [{source}]: {message}");
    if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "[{source}] {message}");
    }
}

fn server_log_files(path: &Path) -> Result<(fs::File, fs::File), String> {
    let file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|e| format!("Failed to open desktop server log: {e}"))?;
    if file.metadata().map(|metadata| metadata.len()).unwrap_or(0) > SERVER_LOG_MAX_BYTES {
        file.set_len(0)
            .map_err(|e| format!("Failed to rotate desktop server log: {e}"))?;
    }
    let stderr = file
        .try_clone()
        .map_err(|e| format!("Failed to clone desktop server log: {e}"))?;
    Ok((file, stderr))
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
        ("macos", "aarch64") => Some(("darwin-arm64", &["darwin-arm64", "bin", "node"], "node")),
        ("macos", "x86_64") => Some(("darwin-x64", &["darwin-x64", "bin", "node"], "node")),
        ("linux", "x86_64") => Some(("linux-x64", &["linux-x64", "bin", "node"], "node")),
        ("linux", "aarch64") => Some(("linux-arm64", &["linux-arm64", "bin", "node"], "node")),
        ("windows", "x86_64") => Some(("win-x64", &["win-x64", "node.exe"], "node.exe")),
        ("windows", "aarch64") => Some(("win-arm64", &["win-arm64", "node.exe"], "node.exe")),
        _ => None,
    }
}

fn bundled_node_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    let server_dirs = resource_server_dirs(app);
    let (_, relative, _) = node_runtime_layout()?;

    for server_dir in server_dirs {
        let base = server_dir.join("node");
        let candidate = relative
            .iter()
            .fold(base, |path, segment| path.join(segment));
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
        let mut permissions = fs::metadata(&dest)
            .map_err(|e| e.to_string())?
            .permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&dest, permissions).map_err(|e| e.to_string())?;
    }

    Ok(dest)
}

fn node_executable_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    if let Some(path) = configured_node_path() {
        Ok(path)
    } else if let Some(path) = bundled_node_path(app) {
        materialized_node_path(app, &path)
    } else {
        Ok(PathBuf::from("node"))
    }
}

fn spawn_server_process(launch: &ServerLaunch, generation: u64) -> Result<ServerProcess, String> {
    let (stdout, stderr) = server_log_files(&launch.log_path)?;
    let mut command = Command::new(&launch.node_path);
    command
        .arg(&launch.server_entry)
        .env("NODE_ENV", "production")
        .env("HOST", "0.0.0.0")
        .env("PORT", launch.port.to_string())
        .env("DS_SERVER_DATA_DIR", &launch.data_dir)
        .env(
            "DS_SERVER_DB_PATH",
            launch.data_dir.join("debridstreamer.sqlite"),
        )
        .env("DS_SERVER_SETUP_TOKEN", &launch.setup_token)
        .env(
            "DS_SERVER_CORS_ORIGIN",
            "http://tauri.localhost,tauri://localhost,http://localhost:5173,http://127.0.0.1:5173",
        )
        .env("DS_SERVER_COOKIE_SECURE", "false")
        .env("DS_SERVER_COOKIE_SAMESITE", "lax")
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr));

    if let Some(web_dist) = &launch.web_dist {
        command.env("DS_WEB_DIST", web_dist);
    }

    let child = command
        .spawn()
        .map_err(|e| format!("Failed to start bundled server with Node: {e}"))?;
    Ok(ServerProcess {
        child,
        port: launch.port,
        setup_token: launch.setup_token.clone(),
        generation,
    })
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
        let mut permissions = fs::metadata(&path)
            .map_err(|e| e.to_string())?
            .permissions();
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

fn wait_while_desired(desired: &AtomicU64, generation: u64, duration: Duration) -> bool {
    let deadline = Instant::now() + duration;
    while Instant::now() < deadline {
        if desired.load(Ordering::Acquire) != generation {
            return false;
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        thread::sleep(Duration::from_millis(100).min(remaining));
    }
    desired.load(Ordering::Acquire) == generation
}

fn wait_for_port_while_desired(port: u16, desired: &AtomicU64, generation: u64) -> bool {
    let deadline = Instant::now() + Duration::from_secs(6);
    while Instant::now() < deadline {
        if desired.load(Ordering::Acquire) != generation {
            return false;
        }
        if port_is_open(port) {
            return true;
        }
        thread::sleep(Duration::from_millis(100));
    }
    false
}

fn spawn_server_monitor(
    process_state: Arc<Mutex<Option<ServerProcess>>>,
    desired_generation: Arc<AtomicU64>,
    generation: u64,
    launch: ServerLaunch,
) -> JoinHandle<()> {
    thread::spawn(move || {
        let mut respawn_attempts = 0_usize;
        'monitor: loop {
            if desired_generation.load(Ordering::Acquire) != generation {
                return;
            }

            let exit_detail = {
                let mut guard = match process_state.lock() {
                    Ok(guard) => guard,
                    Err(error) => {
                        append_server_log(
                            &launch.log_path,
                            "monitor",
                            &format!("state lock failed: {error}"),
                        );
                        return;
                    }
                };
                match guard.as_mut() {
                    Some(process) if process.generation == generation => {
                        match process.child.try_wait() {
                            Ok(Some(status)) => Some(format!("process exited with {status}")),
                            Ok(None) => None,
                            Err(error) => Some(format!("process status failed: {error}")),
                        }
                    }
                    Some(_) => return,
                    None => Some("process was no longer registered".to_string()),
                }
            };

            let Some(exit_detail) = exit_detail else {
                thread::sleep(SERVER_MONITOR_INTERVAL);
                continue;
            };
            append_server_log(&launch.log_path, "monitor", &exit_detail);
            if let Ok(mut guard) = process_state.lock() {
                if guard
                    .as_ref()
                    .map(|process| process.generation == generation)
                    .unwrap_or(false)
                {
                    *guard = None;
                }
            }

            loop {
                if desired_generation.load(Ordering::Acquire) != generation {
                    return;
                }
                if respawn_attempts >= SERVER_MAX_RESPAWN_ATTEMPTS {
                    let _ = desired_generation.compare_exchange(
                        generation,
                        0,
                        Ordering::AcqRel,
                        Ordering::Acquire,
                    );
                    append_server_log(
                        &launch.log_path,
                        "monitor",
                        "respawn limit reached; server left stopped",
                    );
                    return;
                }

                respawn_attempts += 1;
                let multiplier = 1_u32 << (respawn_attempts.saturating_sub(1) as u32);
                let backoff = (Duration::from_millis(250) * multiplier).min(SERVER_MAX_BACKOFF);
                append_server_log(
                    &launch.log_path,
                    "monitor",
                    &format!(
                        "respawn attempt {respawn_attempts}/{SERVER_MAX_RESPAWN_ATTEMPTS} in {} ms",
                        backoff.as_millis()
                    ),
                );
                if !wait_while_desired(&desired_generation, generation, backoff) {
                    return;
                }

                match spawn_server_process(&launch, generation) {
                    Ok(process) => {
                        let mut guard = match process_state.lock() {
                            Ok(guard) => guard,
                            Err(error) => {
                                append_server_log(
                                    &launch.log_path,
                                    "monitor",
                                    &format!("state lock failed: {error}"),
                                );
                                return;
                            }
                        };
                        if desired_generation.load(Ordering::Acquire) != generation {
                            drop(process);
                            return;
                        }
                        *guard = Some(process);
                        drop(guard);

                        if wait_for_port_while_desired(launch.port, &desired_generation, generation)
                        {
                            append_server_log(&launch.log_path, "monitor", "server respawned");
                            // A confirmed-healthy respawn resets the budget so
                            // the cap counts consecutive failures in one crash
                            // burst, not the lifetime total; otherwise a
                            // long-lived server that recovers a handful of
                            // separate times would eventually refuse to respawn.
                            respawn_attempts = 0;
                            continue 'monitor;
                        }
                        if let Ok(mut guard) = process_state.lock() {
                            if guard
                                .as_ref()
                                .map(|process| process.generation == generation)
                                .unwrap_or(false)
                            {
                                *guard = None;
                            }
                        }
                        append_server_log(
                            &launch.log_path,
                            "monitor",
                            "respawned process did not open its port",
                        );
                    }
                    Err(error) => append_server_log(&launch.log_path, "monitor", &error),
                }
            }
        }
    })
}

fn status_for<R: Runtime>(
    app: &AppHandle<R>,
    state: &ServerState,
    detail: Option<String>,
) -> DesktopServerStatus {
    state.prune_exited();
    let port = configured_port();
    let running_process = state.process.lock().ok().and_then(|guard| {
        guard
            .as_ref()
            .map(|process| (process.port, process.setup_token.clone()))
    });
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
    let has_process = state.process.lock().map_err(|e| e.to_string())?.is_some();
    if has_process || state.desired_generation.load(Ordering::Acquire) != 0 {
        return Ok(status_for(&app, &state, None));
    }
    if let Some(handle) = state.monitor.lock().map_err(|e| e.to_string())?.take() {
        let _ = handle.join();
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
    let launch = ServerLaunch {
        node_path: node_executable_path(&app)?,
        server_entry,
        web_dist,
        data_dir,
        setup_token,
        port,
        log_path: app
            .path()
            .app_log_dir()
            .map_err(|e| e.to_string())?
            .join("desktop-server.log"),
    };
    if let Some(parent) = launch.log_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let generation = state.generation();
    state
        .desired_generation
        .store(generation, Ordering::Release);
    let process = match spawn_server_process(&launch, generation) {
        Ok(process) => process,
        Err(error) => {
            state.desired_generation.store(0, Ordering::Release);
            return Err(error);
        }
    };

    {
        let mut guard = state.process.lock().map_err(|e| e.to_string())?;
        *guard = Some(process);
    }

    if !wait_for_port(port) {
        state.desired_generation.store(0, Ordering::Release);
        let mut guard = state.process.lock().map_err(|e| e.to_string())?;
        *guard = None;
        return Err("Server process started but did not open its port.".to_string());
    }
    let monitor = spawn_server_monitor(
        Arc::clone(&state.process),
        Arc::clone(&state.desired_generation),
        generation,
        launch,
    );
    *state.monitor.lock().map_err(|e| e.to_string())? = Some(monitor);

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
    state.desired_generation.store(0, Ordering::Release);
    {
        let mut guard = state.process.lock().map_err(|e| e.to_string())?;
        *guard = None;
    }
    if let Some(handle) = state.monitor.lock().map_err(|e| e.to_string())?.take() {
        let _ = handle.join();
    }
    Ok(status_for(
        &app,
        &state,
        Some("Desktop server stopped.".to_string()),
    ))
}
