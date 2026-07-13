use std::collections::{HashMap, HashSet};
use std::ffi::OsString;
use std::fs;
use std::io::SeekFrom;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::{Component, Path, PathBuf};
use std::process::{Command as StdCommand, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use futures_util::future::{AbortHandle, Abortable};
use futures_util::StreamExt;
use reqwest::header::{
    HeaderMap, HeaderName, HeaderValue, ACCEPT_ENCODING, CONTENT_LENGTH, CONTENT_RANGE, RANGE,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tokio::io::{
    AsyncBufReadExt, AsyncReadExt, AsyncSeekExt, AsyncWriteExt, BufReader, BufWriter,
};
use tokio::process::Command;

const PROGRESS_INTERVAL: Duration = Duration::from_millis(500);
const DOWNLOAD_BUFFER_CAPACITY: usize = 1024 * 1024;
const DELETE_RETRY_INTERVAL: Duration = Duration::from_millis(50);
const DELETE_RETRIES: usize = 20;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadStartArgs {
    job_id: String,
    url: String,
    #[serde(default)]
    headers: HashMap<String, String>,
    dest_path: String,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
enum TranscodeProfile {
    Remux,
    H265,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscodeStartArgs {
    job_id: String,
    input_path: String,
    output_path: String,
    keep_audio_langs: Vec<String>,
    keep_sub_langs: Vec<String>,
    profile: TranscodeProfile,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadProgress {
    job_id: String,
    phase: &'static str,
    bytes_done: u64,
    bytes_total: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    speed_bps: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    output_path: Option<String>,
}

#[derive(Clone)]
enum JobSpec {
    Download(DownloadStartArgs),
    Transcode { output_path: String },
}

struct JobHandle {
    generation: u64,
    abort: Option<AbortHandle>,
    spec: JobSpec,
    last_done: Arc<AtomicU64>,
}

#[derive(Default)]
pub struct DownloadsState {
    jobs: Mutex<HashMap<String, JobHandle>>,
    next_generation: AtomicU64,
}

impl DownloadsState {
    fn generation(&self) -> u64 {
        self.next_generation.fetch_add(1, Ordering::Relaxed) + 1
    }
}

fn progress(
    job_id: &str,
    phase: &'static str,
    bytes_done: u64,
    bytes_total: Option<u64>,
) -> DownloadProgress {
    DownloadProgress {
        job_id: job_id.to_string(),
        phase,
        bytes_done,
        bytes_total,
        speed_bps: None,
        error: None,
        output_path: None,
    }
}

fn emit_progress_if_current<R: Runtime>(
    app: &AppHandle<R>,
    generation: u64,
    payload: DownloadProgress,
) {
    let current = app
        .state::<DownloadsState>()
        .jobs
        .lock()
        .map(|jobs| {
            jobs.get(&payload.job_id)
                .map(|job| job.generation == generation)
                .unwrap_or(false)
        })
        .unwrap_or(false);
    if current {
        let _ = app.emit("download-progress", payload);
    }
}

fn finish_if_current<R: Runtime>(
    app: &AppHandle<R>,
    generation: u64,
    payload: DownloadProgress,
) {
    let should_emit = app
        .state::<DownloadsState>()
        .jobs
        .lock()
        .map(|mut jobs| {
            let current = jobs
                .get(&payload.job_id)
                .map(|job| job.generation == generation)
                .unwrap_or(false);
            if current {
                jobs.remove(&payload.job_id);
            }
            current
        })
        .unwrap_or(false);
    if should_emit {
        let _ = app.emit("download-progress", payload);
    }
}

/// Reject a filesystem target that is not absolute or that escapes its
/// directory through a `..` component. Paths arrive over the IPC boundary, so
/// this keeps a hostile `destPath`/`outputPath` from writing outside the
/// downloads folder even though the caller supplies the base directory.
fn validate_confined_path(path: &str, label: &str) -> Result<(), String> {
    let path = Path::new(path);
    if !path.is_absolute() {
        return Err(format!("{label} must be absolute."));
    }
    if path
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return Err(format!(
            "{label} must not contain parent-directory (..) segments."
        ));
    }
    Ok(())
}

fn validate_download_args(args: &DownloadStartArgs) -> Result<(), String> {
    if args.job_id.trim().is_empty() {
        return Err("jobId must not be empty.".to_string());
    }
    if args.url.trim().is_empty() {
        return Err("url must not be empty.".to_string());
    }
    validate_confined_path(&args.dest_path, "destPath")?;
    Ok(())
}

fn spawn_download_worker<R: Runtime>(
    app: AppHandle<R>,
    args: DownloadStartArgs,
    generation: u64,
    offset: u64,
    last_done: Arc<AtomicU64>,
    registration: futures_util::future::AbortRegistration,
) {
    tauri::async_runtime::spawn(async move {
        let worker = async {
            let result = transfer_download(
                &app,
                &args,
                generation,
                offset,
                Arc::clone(&last_done),
            )
            .await;
            match result {
                Ok((bytes_done, bytes_total)) => {
                    let mut terminal = progress(
                        &args.job_id,
                        "completed",
                        bytes_done,
                        bytes_total,
                    );
                    terminal.output_path = Some(args.dest_path.clone());
                    finish_if_current(&app, generation, terminal);
                }
                Err(error) => {
                    let mut terminal = progress(
                        &args.job_id,
                        "failed",
                        last_done.load(Ordering::Relaxed),
                        None,
                    );
                    terminal.error = Some(error);
                    finish_if_current(&app, generation, terminal);
                }
            }
        };
        let _ = Abortable::new(worker, registration).await;
    });
}

fn insert_download_job<R: Runtime>(
    app: AppHandle<R>,
    state: &DownloadsState,
    args: DownloadStartArgs,
    offset: u64,
    last_done: Arc<AtomicU64>,
) -> Result<(), String> {
    let generation = state.generation();
    let (abort, registration) = AbortHandle::new_pair();
    {
        let mut jobs = state.jobs.lock().map_err(|e| e.to_string())?;
        if jobs.contains_key(&args.job_id) {
            return Err(format!("A job with id {} already exists.", args.job_id));
        }
        jobs.insert(
            args.job_id.clone(),
            JobHandle {
                generation,
                abort: Some(abort),
                spec: JobSpec::Download(args.clone()),
                last_done: Arc::clone(&last_done),
            },
        );
    }
    spawn_download_worker(app, args, generation, offset, last_done, registration);
    Ok(())
}

#[tauri::command]
pub fn download_start<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, DownloadsState>,
    args: DownloadStartArgs,
) -> Result<(), String> {
    validate_download_args(&args)?;
    // A start is always fresh: truncate from offset 0 so a stale or unrelated
    // file already at destPath can never be appended onto or falsely completed.
    // Continuing a partial transfer is the exclusive job of download_resume.
    let last_done = Arc::new(AtomicU64::new(0));
    insert_download_job(app, &state, args, 0, last_done)
}

#[tauri::command]
pub fn download_pause(
    state: State<'_, DownloadsState>,
    job_id: String,
) -> Result<(), String> {
    let abort = {
        let mut jobs = state.jobs.lock().map_err(|e| e.to_string())?;
        let job = jobs
            .get_mut(&job_id)
            .ok_or_else(|| format!("Download job {job_id} was not found."))?;
        if !matches!(&job.spec, JobSpec::Download(_)) {
            return Err(format!("Job {job_id} is not a download."));
        }
        if job.abort.is_none() {
            return Ok(());
        }
        job.generation = state.generation();
        job.abort.take()
    };
    if let Some(abort) = abort {
        abort.abort();
    }
    Ok(())
}

#[tauri::command]
pub fn download_resume<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, DownloadsState>,
    job_id: String,
) -> Result<(), String> {
    let (args, last_done, generation, registration) = {
        let mut jobs = state.jobs.lock().map_err(|e| e.to_string())?;
        let job = jobs
            .get_mut(&job_id)
            .ok_or_else(|| format!("Download job {job_id} was not found."))?;
        let JobSpec::Download(args) = &job.spec else {
            return Err(format!("Job {job_id} is not a download."));
        };
        if job.abort.is_some() {
            return Err(format!("Download job {job_id} is already running."));
        }
        let args = args.clone();
        let last_done = Arc::clone(&job.last_done);
        let generation = state.generation();
        let (abort, registration) = AbortHandle::new_pair();
        job.generation = generation;
        job.abort = Some(abort);
        (args, last_done, generation, registration)
    };

    let offset = fs::metadata(&args.dest_path).map(|m| m.len()).unwrap_or(0);
    last_done.store(offset, Ordering::Relaxed);
    spawn_download_worker(app, args, generation, offset, last_done, registration);
    Ok(())
}

#[tauri::command]
pub async fn download_cancel<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, DownloadsState>,
    job_id: String,
) -> Result<(), String> {
    let job = {
        let mut jobs = state.jobs.lock().map_err(|e| e.to_string())?;
        let is_download = jobs
            .get(&job_id)
            .map(|job| matches!(&job.spec, JobSpec::Download(_)))
            .ok_or_else(|| format!("Download job {job_id} was not found."))?;
        if !is_download {
            return Err(format!("Job {job_id} is not a download."));
        }
        jobs.remove(&job_id).expect("download job checked above")
    };

    if let Some(abort) = job.abort {
        abort.abort();
    }
    let JobSpec::Download(args) = job.spec else {
        unreachable!("download job checked above");
    };
    let bytes_done = fs::metadata(&args.dest_path)
        .map(|metadata| metadata.len())
        .unwrap_or_else(|_| job.last_done.load(Ordering::Relaxed));
    if let Err(error) = remove_partial_file(Path::new(&args.dest_path)).await {
        let message = format!("Failed to remove partial download: {error}");
        let mut terminal = progress(&job_id, "failed", bytes_done, None);
        terminal.error = Some(message.clone());
        let _ = app.emit("download-progress", terminal);
        return Err(message);
    }
    let _ = app.emit(
        "download-progress",
        progress(&job_id, "canceled", bytes_done, None),
    );
    Ok(())
}

async fn remove_partial_file(path: &Path) -> Result<(), std::io::Error> {
    for attempt in 0..DELETE_RETRIES {
        match tokio::fs::remove_file(path).await {
            Ok(()) => return Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error)
                if error.kind() == std::io::ErrorKind::PermissionDenied
                    && attempt + 1 < DELETE_RETRIES =>
            {
                tokio::time::sleep(DELETE_RETRY_INTERVAL).await;
            }
            Err(error) => return Err(error),
        }
    }
    Ok(())
}

/// Strip the query string, fragment, and any embedded credentials from a URL.
/// Resolved debrid links can carry a secret in the query (for example TorBox's
/// `?token=`), so this keeps a token out of any error message, log line, or
/// `download-progress` event.
fn redact_url(url: &str) -> String {
    match reqwest::Url::parse(url) {
        Ok(mut parsed) => {
            parsed.set_query(None);
            parsed.set_fragment(None);
            let _ = parsed.set_username("");
            let _ = parsed.set_password(None);
            parsed.to_string()
        }
        // Not a parseable absolute URL: drop everything from the first `?`/`#`.
        Err(_) => url
            .split(|c| c == '?' || c == '#')
            .next()
            .unwrap_or("")
            .to_string(),
    }
}

/// Format a reqwest failure without leaking the request URL's query/credentials.
/// reqwest's own `Display` appends the full URL, so the error is never formatted
/// directly — only its redacted URL and underlying transport cause (which does
/// not carry the URL) are surfaced.
fn redact_reqwest_error(context: &str, error: &reqwest::Error) -> String {
    let mut message = context.to_string();
    if let Some(url) = error.url() {
        message.push_str(&format!(" for {}", redact_url(url.as_str())));
    }
    if let Some(source) = std::error::Error::source(error) {
        message.push_str(&format!(": {source}"));
    }
    message
}

async fn transfer_download<R: Runtime>(
    app: &AppHandle<R>,
    args: &DownloadStartArgs,
    generation: u64,
    requested_offset: u64,
    last_done: Arc<AtomicU64>,
) -> Result<(u64, Option<u64>), String> {
    let dest = Path::new(&args.dest_path);
    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Failed to create download directory: {e}"))?;
    }

    let mut headers = HeaderMap::new();
    for (name, value) in &args.headers {
        let name = HeaderName::from_bytes(name.as_bytes())
            .map_err(|e| format!("Invalid request header name: {e}"))?;
        let value = HeaderValue::from_str(value)
            .map_err(|e| format!("Invalid request header value: {e}"))?;
        headers.insert(name, value);
    }
    headers.insert(ACCEPT_ENCODING, HeaderValue::from_static("identity"));
    if requested_offset > 0 {
        headers.insert(
            RANGE,
            HeaderValue::from_str(&format!("bytes={requested_offset}-"))
                .map_err(|e| e.to_string())?,
        );
    }

    let response = reqwest::Client::new()
        .get(&args.url)
        .headers(headers)
        .send()
        .await
        .map_err(|e| redact_reqwest_error("Download request failed", &e))?;
    let status = response.status();
    if status == reqwest::StatusCode::RANGE_NOT_SATISFIABLE {
        let total = response
            .headers()
            .get(CONTENT_RANGE)
            .and_then(|value| value.to_str().ok())
            .and_then(parse_unsatisfied_total);
        if total == Some(requested_offset) {
            return Ok((requested_offset, total));
        }
    }
    if !status.is_success() {
        return Err(format!("Download server returned HTTP {status}."));
    }

    let append = requested_offset > 0 && status == reqwest::StatusCode::PARTIAL_CONTENT;
    if append {
        let response_offset = response
            .headers()
            .get(CONTENT_RANGE)
            .and_then(|value| value.to_str().ok())
            .and_then(parse_content_range_start);
        if response_offset != Some(requested_offset) {
            return Err("Download server returned an invalid Content-Range.".to_string());
        }
    }
    let offset = if append { requested_offset } else { 0 };
    let bytes_total = response
        .headers()
        .get(CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
        .map(|length| offset.saturating_add(length));

    let mut file = tokio::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(offset == 0)
        .open(dest)
        .await
        .map_err(|e| format!("Failed to open download destination: {e}"))?;
    // Positioned writes (seek to the resume offset) rather than O_APPEND: if a
    // just-paused worker races one final chunk past cooperative abort while a
    // resumed worker is running, both write the same bytes at the same offsets,
    // so the file can never be corrupted by interleaved appends.
    if offset > 0 {
        file.seek(SeekFrom::Start(offset))
            .await
            .map_err(|e| format!("Failed to seek download destination: {e}"))?;
    }
    let mut file = BufWriter::with_capacity(DOWNLOAD_BUFFER_CAPACITY, file);
    let mut stream = response.bytes_stream();
    let mut bytes_done = offset;
    last_done.store(bytes_done, Ordering::Relaxed);
    let mut last_emit = Instant::now();
    let mut last_emit_bytes = bytes_done;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| redact_reqwest_error("Download stream failed", &e))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Failed to write download: {e}"))?;
        bytes_done = bytes_done.saturating_add(chunk.len() as u64);
        last_done.store(bytes_done, Ordering::Relaxed);

        let elapsed = last_emit.elapsed();
        if elapsed >= PROGRESS_INTERVAL {
            file.flush()
                .await
                .map_err(|e| format!("Failed to flush download: {e}"))?;
            let delta = bytes_done.saturating_sub(last_emit_bytes);
            let mut payload = progress(&args.job_id, "downloading", bytes_done, bytes_total);
            if elapsed.as_secs_f64() > 0.0 {
                payload.speed_bps = Some((delta as f64 / elapsed.as_secs_f64()) as u64);
            }
            emit_progress_if_current(app, generation, payload);
            last_emit = Instant::now();
            last_emit_bytes = bytes_done;
        }
    }
    file.flush()
        .await
        .map_err(|e| format!("Failed to flush download: {e}"))?;
    Ok((bytes_done, bytes_total))
}

fn parse_unsatisfied_total(value: &str) -> Option<u64> {
    value.strip_prefix("bytes */")?.parse().ok()
}

fn parse_content_range_start(value: &str) -> Option<u64> {
    value.strip_prefix("bytes ")?.split('-').next()?.parse().ok()
}

fn ffmpeg_layout() -> Option<(&'static str, &'static str, &'static str)> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => Some(("darwin-arm64", "ffmpeg", "ffprobe")),
        ("macos", "x86_64") => Some(("darwin-x64", "ffmpeg", "ffprobe")),
        ("linux", "aarch64") => Some(("linux-arm64", "ffmpeg", "ffprobe")),
        ("linux", "x86_64") => Some(("linux-x64", "ffmpeg", "ffprobe")),
        ("windows", "aarch64") => Some(("win-arm64", "ffmpeg.exe", "ffprobe.exe")),
        ("windows", "x86_64") => Some(("win-x64", "ffmpeg.exe", "ffprobe.exe")),
        _ => None,
    }
}

fn ffmpeg_resource_dirs<R: Runtime>(app: &AppHandle<R>) -> Vec<PathBuf> {
    app.path()
        .resource_dir()
        .map(|resource_dir| {
            vec![
                resource_dir.join("ffmpeg"),
                resource_dir.join("resources").join("ffmpeg"),
            ]
        })
        .unwrap_or_default()
}

fn bundled_tool_path<R: Runtime>(app: &AppHandle<R>, tool: &str) -> Option<PathBuf> {
    let (platform, ffmpeg_name, ffprobe_name) = ffmpeg_layout()?;
    let file_name = match tool {
        "ffmpeg" => ffmpeg_name,
        "ffprobe" => ffprobe_name,
        _ => return None,
    };
    for root in ffmpeg_resource_dirs(app) {
        let candidate = root.join(platform).join(file_name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

fn materialized_tool_path<R: Runtime>(
    app: &AppHandle<R>,
    tool: &str,
    bundled: &Path,
) -> Result<PathBuf, String> {
    let (platform, ffmpeg_name, ffprobe_name) =
        ffmpeg_layout().ok_or_else(|| "Unsupported ffmpeg platform.".to_string())?;
    let file_name = if tool == "ffmpeg" {
        ffmpeg_name
    } else {
        ffprobe_name
    };
    let dest_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("downloads")
        .join("ffmpeg")
        .join(platform);
    let dest = dest_dir.join(file_name);
    let should_copy = match (fs::metadata(bundled), fs::metadata(&dest)) {
        (Ok(source), Ok(existing)) => source.len() != existing.len(),
        (Ok(_), Err(_)) => true,
        (Err(error), _) => return Err(format!("Failed to inspect bundled {tool}: {error}")),
    };
    if should_copy {
        fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;
        fs::copy(bundled, &dest)
            .map_err(|e| format!("Failed to materialize bundled {tool}: {e}"))?;
    }
    #[cfg(unix)]
    {
        let mut permissions = fs::metadata(&dest).map_err(|e| e.to_string())?.permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&dest, permissions).map_err(|e| e.to_string())?;
    }
    Ok(dest)
}

fn executable_path<R: Runtime>(app: &AppHandle<R>, tool: &str) -> Result<PathBuf, String> {
    if let Some(bundled) = bundled_tool_path(app, tool) {
        materialized_tool_path(app, tool, &bundled)
    } else {
        Ok(PathBuf::from(tool))
    }
}

fn executable_on_path(tool: &str) -> bool {
    StdCommand::new(tool)
        .arg("-version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

#[tauri::command]
pub async fn downloads_ffmpeg_available<R: Runtime>(app: AppHandle<R>) -> bool {
    tokio::task::spawn_blocking(move || {
        bundled_tool_path(&app, "ffmpeg").is_some() || executable_on_path("ffmpeg")
    })
    .await
    .unwrap_or(false)
}

#[tauri::command]
pub async fn downloads_default_dir() -> Result<String, String> {
    let base = dirs::video_dir()
        .or_else(dirs::download_dir)
        .or_else(dirs::home_dir)
        .ok_or_else(|| "Could not resolve a user downloads directory.".to_string())?;
    let path = base.join("DebridStreamer");
    tokio::fs::create_dir_all(&path)
        .await
        .map_err(|e| format!("Failed to create downloads directory: {e}"))?;
    Ok(path.to_string_lossy().into_owned())
}

#[derive(Deserialize)]
struct ProbeOutput {
    #[serde(default)]
    streams: Vec<ProbeStream>,
    format: Option<ProbeFormat>,
}

#[derive(Deserialize)]
struct ProbeStream {
    codec_type: Option<String>,
    tags: Option<ProbeTags>,
}

#[derive(Deserialize)]
struct ProbeTags {
    language: Option<String>,
}

#[derive(Deserialize)]
struct ProbeFormat {
    duration: Option<String>,
}

async fn probe_input(ffprobe: &Path, input: &str) -> Result<ProbeOutput, String> {
    let output = Command::new(ffprobe)
        .arg("-v")
        .arg("error")
        .arg("-show_entries")
        .arg("stream=index,codec_type:stream_tags=language:format=duration")
        .arg("-of")
        .arg("json")
        .arg(input)
        .output()
        .await
        .map_err(|e| format!("Failed to run ffprobe: {e}"))?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if detail.is_empty() {
            format!("ffprobe exited with {}.", output.status)
        } else {
            format!("ffprobe failed: {detail}")
        });
    }
    serde_json::from_slice(&output.stdout).map_err(|e| format!("Invalid ffprobe output: {e}"))
}

fn matching_languages(
    streams: &[ProbeStream],
    codec_type: &str,
    requested: &[String],
) -> Vec<String> {
    let mut seen = HashSet::new();
    requested
        .iter()
        .filter_map(|language| {
            streams.iter().find_map(|stream| {
                if stream.codec_type.as_deref() != Some(codec_type) {
                    return None;
                }
                let actual = stream.tags.as_ref()?.language.as_deref()?;
                language_equivalent(actual, language).then(|| actual.to_string())
            })
        })
        .filter(|language| seen.insert(language.to_ascii_lowercase()))
        .collect()
}

fn language_equivalent(left: &str, right: &str) -> bool {
    let left = left.to_ascii_lowercase();
    let right = right.to_ascii_lowercase();
    if left == right {
        return true;
    }
    let aliases: &[&[&str]] = &[
        &["en", "eng"],
        &["es", "spa"],
        &["fr", "fra", "fre"],
        &["de", "deu", "ger"],
        &["it", "ita"],
        &["pt", "por"],
        &["ja", "jpn"],
        &["ko", "kor"],
        &["zh", "zho", "chi"],
        &["ar", "ara"],
        &["hi", "hin"],
        &["ru", "rus"],
    ];
    aliases
        .iter()
        .any(|group| group.contains(&left.as_str()) && group.contains(&right.as_str()))
}

fn ffmpeg_args(args: &TranscodeStartArgs, probe: &ProbeOutput) -> Vec<OsString> {
    let mut result: Vec<OsString> = ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i"]
        .into_iter()
        .map(OsString::from)
        .collect();
    result.push(OsString::from(&args.input_path));
    result.extend(["-map", "0:v:0"].into_iter().map(OsString::from));

    if args.keep_audio_langs.is_empty() {
        result.extend(["-map", "0:a?"].into_iter().map(OsString::from));
    } else {
        let matches = matching_languages(&probe.streams, "audio", &args.keep_audio_langs);
        if matches.is_empty() {
            result.extend(["-map", "0:a?"].into_iter().map(OsString::from));
        } else {
            for language in matches {
                result.push(OsString::from("-map"));
                result.push(OsString::from(format!("0:a:m:language:{language}")));
            }
        }
    }

    if args.keep_sub_langs.is_empty() {
        result.extend(["-map", "0:s?"].into_iter().map(OsString::from));
    } else {
        for language in matching_languages(&probe.streams, "subtitle", &args.keep_sub_langs) {
            result.push(OsString::from("-map"));
            result.push(OsString::from(format!("0:s:m:language:{language}")));
        }
    }

    match args.profile {
        TranscodeProfile::Remux => {
            result.extend(["-c", "copy"].into_iter().map(OsString::from));
        }
        TranscodeProfile::H265 => {
            result.extend(
                [
                    "-c:v", "libx265", "-crf", "23", "-preset", "medium", "-c:a", "copy",
                    "-c:s", "copy",
                ]
                .into_iter()
                .map(OsString::from),
            );
        }
    }
    if Path::new(&args.output_path)
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.eq_ignore_ascii_case("mp4"))
        .unwrap_or(false)
    {
        result.extend(["-movflags", "+faststart"].into_iter().map(OsString::from));
    }
    result.extend(
        ["-progress", "pipe:1", "-nostats"]
            .into_iter()
            .map(OsString::from),
    );
    result.push(OsString::from(&args.output_path));
    result
}

fn spawn_transcode_worker<R: Runtime>(
    app: AppHandle<R>,
    args: TranscodeStartArgs,
    generation: u64,
    last_done: Arc<AtomicU64>,
    registration: futures_util::future::AbortRegistration,
) {
    tauri::async_runtime::spawn(async move {
        let worker = async {
            let result = run_transcode(
                &app,
                &args,
                generation,
                Arc::clone(&last_done),
            )
            .await;
            match result {
                Ok(()) => {
                    last_done.store(100, Ordering::Relaxed);
                    let mut terminal = progress(&args.job_id, "completed", 100, Some(100));
                    terminal.output_path = Some(args.output_path.clone());
                    finish_if_current(&app, generation, terminal);
                }
                Err(error) => {
                    let mut terminal = progress(
                        &args.job_id,
                        "failed",
                        last_done.load(Ordering::Relaxed),
                        Some(100),
                    );
                    terminal.error = Some(error);
                    finish_if_current(&app, generation, terminal);
                }
            }
        };
        let _ = Abortable::new(worker, registration).await;
    });
}

#[tauri::command]
pub fn transcode_start<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, DownloadsState>,
    args: TranscodeStartArgs,
) -> Result<(), String> {
    if args.job_id.trim().is_empty() {
        return Err("jobId must not be empty.".to_string());
    }
    validate_confined_path(&args.input_path, "inputPath")?;
    validate_confined_path(&args.output_path, "outputPath")?;
    let generation = state.generation();
    let (abort, registration) = AbortHandle::new_pair();
    let last_done = Arc::new(AtomicU64::new(0));
    {
        let mut jobs = state.jobs.lock().map_err(|e| e.to_string())?;
        if jobs.contains_key(&args.job_id) {
            return Err(format!("A job with id {} already exists.", args.job_id));
        }
        jobs.insert(
            args.job_id.clone(),
            JobHandle {
                generation,
                abort: Some(abort),
                spec: JobSpec::Transcode {
                    output_path: args.output_path.clone(),
                },
                last_done: Arc::clone(&last_done),
            },
        );
    }
    spawn_transcode_worker(app, args, generation, last_done, registration);
    Ok(())
}

#[tauri::command]
pub async fn transcode_cancel<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, DownloadsState>,
    job_id: String,
) -> Result<(), String> {
    let job = {
        let mut jobs = state.jobs.lock().map_err(|e| e.to_string())?;
        let is_transcode = jobs
            .get(&job_id)
            .map(|job| matches!(&job.spec, JobSpec::Transcode { .. }))
            .ok_or_else(|| format!("Transcode job {job_id} was not found."))?;
        if !is_transcode {
            return Err(format!("Job {job_id} is not a transcode."));
        }
        jobs.remove(&job_id).expect("transcode job checked above")
    };
    if let Some(abort) = job.abort {
        abort.abort();
    }
    let JobSpec::Transcode { output_path } = job.spec else {
        unreachable!("transcode job checked above");
    };
    if let Err(error) = remove_partial_file(Path::new(&output_path)).await {
        let message = format!("Failed to remove partial transcode: {error}");
        let mut terminal = progress(
            &job_id,
            "failed",
            job.last_done.load(Ordering::Relaxed),
            Some(100),
        );
        terminal.error = Some(message.clone());
        let _ = app.emit("download-progress", terminal);
        return Err(message);
    }
    let _ = app.emit(
        "download-progress",
        progress(
            &job_id,
            "canceled",
            job.last_done.load(Ordering::Relaxed),
            Some(100),
        ),
    );
    Ok(())
}

async fn run_transcode<R: Runtime>(
    app: &AppHandle<R>,
    args: &TranscodeStartArgs,
    generation: u64,
    last_done: Arc<AtomicU64>,
) -> Result<(), String> {
    if let Some(parent) = Path::new(&args.output_path).parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Failed to create transcode directory: {e}"))?;
    }
    let ffmpeg = executable_path(app, "ffmpeg")?;
    let ffprobe = executable_path(app, "ffprobe")?;
    let probe = probe_input(&ffprobe, &args.input_path).await?;
    let duration_seconds = probe
        .format
        .as_ref()
        .and_then(|format| format.duration.as_deref())
        .and_then(|duration| duration.parse::<f64>().ok())
        .filter(|duration| *duration > 0.0);

    emit_progress_if_current(
        app,
        generation,
        progress(&args.job_id, "optimizing", 0, Some(100)),
    );
    let mut child = Command::new(ffmpeg)
        .args(ffmpeg_args(args, &probe))
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("Failed to start ffmpeg: {e}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture ffmpeg progress.".to_string())?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to capture ffmpeg errors.".to_string())?;
    let stderr_task = tokio::spawn(async move {
        let mut detail = String::new();
        let _ = stderr.read_to_string(&mut detail).await;
        detail
    });
    let mut lines = BufReader::new(stdout).lines();
    let mut monotonic = 0_u64;
    while let Some(line) = lines
        .next_line()
        .await
        .map_err(|e| format!("Failed to read ffmpeg progress: {e}"))?
    {
        let Some(value) = line.strip_prefix("out_time_ms=") else {
            continue;
        };
        let Some(duration) = duration_seconds else {
            continue;
        };
        let Ok(out_time_microseconds) = value.parse::<f64>() else {
            continue;
        };
        let percent = ((out_time_microseconds / 1_000_000.0) / duration * 100.0)
            .floor()
            .clamp(0.0, 99.0) as u64;
        if percent > monotonic {
            monotonic = percent;
            last_done.store(percent, Ordering::Relaxed);
            emit_progress_if_current(
                app,
                generation,
                progress(&args.job_id, "optimizing", percent, Some(100)),
            );
        }
    }
    let status = child
        .wait()
        .await
        .map_err(|e| format!("Failed to wait for ffmpeg: {e}"))?;
    let detail = stderr_task.await.unwrap_or_default().trim().to_string();
    if !status.success() {
        return Err(if detail.is_empty() {
            format!("ffmpeg exited with {status}.")
        } else {
            format!("ffmpeg failed: {detail}")
        });
    }
    if !Path::new(&args.output_path).is_file() {
        return Err("ffmpeg exited successfully but did not create the output file.".to_string());
    }
    Ok(())
}
