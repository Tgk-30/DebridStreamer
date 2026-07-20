use tauri::{Runtime, WebviewWindow};

const CLOUDFLARE_ACCESS_COOKIE_NAMES: [&str; 3] =
    ["CF_Authorization", "CF_Session", "CF_AppSession"];
pub(crate) const MAX_ACCESS_COOKIE_VALUE_BYTES: usize = 4096;
const MAX_ACCESS_COOKIE_HEADER_BYTES: usize = 8192;

#[derive(Clone)]
pub(crate) enum PlaybackAuthentication {
    Bearer {
        authorization: String,
        cookie_header: Option<String>,
    },
    LegacySession {
        cookie_header: String,
    },
}

#[derive(Clone)]
pub(crate) struct AuthenticatedPlayback {
    target_url: String,
    authentication: PlaybackAuthentication,
}

impl AuthenticatedPlayback {
    pub(crate) fn target_url(&self) -> &str {
        &self.target_url
    }

    pub(crate) fn authorization(&self) -> Option<&str> {
        match &self.authentication {
            PlaybackAuthentication::Bearer { authorization, .. } => Some(authorization),
            PlaybackAuthentication::LegacySession { .. } => None,
        }
    }

    pub(crate) fn cookie_header(&self) -> Option<&str> {
        match &self.authentication {
            PlaybackAuthentication::Bearer { cookie_header, .. } => cookie_header.as_deref(),
            PlaybackAuthentication::LegacySession { cookie_header } => Some(cookie_header),
        }
    }

    #[cfg(test)]
    pub(crate) fn test_bearer(target_url: String) -> Self {
        Self {
            target_url,
            authentication: PlaybackAuthentication::Bearer {
                authorization: format!("Bearer {}", "A".repeat(43)),
                cookie_header: Some("CF_Session=test".to_string()),
            },
        }
    }

    #[cfg(test)]
    pub(crate) fn test_legacy(target_url: String, cookie_header: String) -> Self {
        Self {
            target_url,
            authentication: PlaybackAuthentication::LegacySession { cookie_header },
        }
    }
}

fn is_server_playback_path(path: &str) -> bool {
    let Some((prefix, stream_id)) = path.rsplit_once("/api/stream/") else {
        return false;
    };
    (prefix.is_empty() || prefix.starts_with('/'))
        && stream_id.len() == 39
        && stream_id.starts_with("stream_")
        && stream_id[7..]
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
}

fn server_playback_url(url: &str) -> Result<Option<tauri::Url>, String> {
    let Ok(parsed) = url.parse::<tauri::Url>() else {
        return Ok(None);
    };
    if !is_server_playback_path(parsed.path()) {
        return Ok(None);
    }
    if !matches!(parsed.scheme(), "http" | "https")
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err("server playback URL is invalid".to_string());
    }
    Ok(Some(parsed))
}

pub(crate) fn validate_stream_authorization(
    url: &str,
    authorization: Option<&str>,
) -> Result<Option<String>, String> {
    let server_url = server_playback_url(url)?;
    let Some(authorization) = authorization else {
        return Ok(None);
    };
    if server_url.is_none() {
        return Err("stream authorization is only allowed for server playback URLs".to_string());
    }
    let Some(token) = authorization.strip_prefix("Bearer ") else {
        return Err("stream authorization must use Bearer".to_string());
    };
    if token.len() != 43
        || !token
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
    {
        return Err("stream authorization token is malformed".to_string());
    }
    Ok(Some(authorization.to_string()))
}

pub(crate) fn same_http_origin(page_url: &tauri::Url, target_url: &tauri::Url) -> bool {
    matches!(page_url.scheme(), "http" | "https")
        && page_url.scheme() == target_url.scheme()
        && matches!(
            (page_url.host_str(), target_url.host_str()),
            (Some(page_host), Some(target_host)) if page_host == target_host
        )
        && page_url.port_or_known_default() == target_url.port_or_known_default()
}

fn is_trusted_bundled_app_origin(page_url: &tauri::Url) -> bool {
    if !page_url.username().is_empty() || page_url.password().is_some() {
        return false;
    }
    match page_url.scheme() {
        "tauri" => page_url.host_str() == Some("localhost") && page_url.port().is_none(),
        // This is Tauri's WRY workaround origin for bundled assets with this
        // app's default non-HTTPS custom protocol configuration.
        "http" => {
            page_url.host_str() == Some("tauri.localhost")
                && page_url.port_or_known_default() == Some(80)
        }
        _ => false,
    }
}

fn validate_authenticated_origin(
    page_url: &tauri::Url,
    target_url: &tauri::Url,
) -> Result<(), String> {
    if same_http_origin(page_url, target_url) || is_trusted_bundled_app_origin(page_url) {
        Ok(())
    } else {
        Err("authenticated playback origin is not allowed".to_string())
    }
}

fn is_safe_cookie_value(value: &str) -> bool {
    // RFC 6265 cookie-octet excludes controls, whitespace, quotes, comma,
    // semicolon and backslash. Comma is also unsafe in mpv file options.
    !value.is_empty()
        && value.len() <= MAX_ACCESS_COOKIE_VALUE_BYTES
        && value.bytes().all(|byte| {
            matches!(
                byte,
                0x21 | 0x23..=0x2b | 0x2d..=0x3a | 0x3c..=0x5b | 0x5d..=0x7e
            )
        })
}

pub(crate) fn cookie_path_matches(request_path: &str, cookie_path: Option<&str>) -> bool {
    let Some(cookie_path) = cookie_path.filter(|path| path.starts_with('/')) else {
        return false;
    };
    if request_path == cookie_path {
        return true;
    }
    let Some(suffix) = request_path.strip_prefix(cookie_path) else {
        return false;
    };
    cookie_path.ends_with('/') || suffix.starts_with('/')
}

pub(crate) fn cloudflare_access_cookie_header<'a>(
    request_path: &str,
    cookies: impl IntoIterator<Item = (&'a str, &'a str, Option<&'a str>)>,
) -> Option<String> {
    cookie_header_for_names(request_path, &CLOUDFLARE_ACCESS_COOKIE_NAMES, None, cookies)
}

fn is_legacy_session_value(value: &str) -> bool {
    let Some((session_id, token)) = value
        .strip_prefix("sess_")
        .and_then(|value| value.split_once('.'))
    else {
        return false;
    };
    session_id.len() == 32
        && session_id
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
        && token.len() == 43
        && token
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

fn cookie_header_for_names<'a>(
    request_path: &str,
    allowed_names: &[&str],
    required_name: Option<&str>,
    cookies: impl IntoIterator<Item = (&'a str, &'a str, Option<&'a str>)>,
) -> Option<String> {
    let mut selected: Vec<Option<(&str, &str)>> = vec![None; allowed_names.len()];
    for (name, value, path) in cookies {
        let Some(index) = allowed_names.iter().position(|allowed| *allowed == name) else {
            continue;
        };
        let Some(path) = path else {
            continue;
        };
        if !is_safe_cookie_value(value)
            || (name == "ds_session" && !is_legacy_session_value(value))
            || !cookie_path_matches(request_path, Some(path))
        {
            continue;
        }
        let replace = selected[index]
            .map(|(selected_value, selected_path)| {
                path.len() > selected_path.len()
                    || (path.len() == selected_path.len()
                        && (path, value) < (selected_path, selected_value))
            })
            .unwrap_or(true);
        if replace {
            selected[index] = Some((value, path));
        }
    }

    let mut header = String::new();
    if required_name.is_some_and(|required| {
        allowed_names
            .iter()
            .position(|name| *name == required)
            .is_none_or(|index| selected[index].is_none())
    }) {
        return None;
    }
    for (name, selected) in allowed_names.iter().zip(selected) {
        let Some((value, _)) = selected else {
            continue;
        };
        let additional_len = usize::from(!header.is_empty()) * 2 + name.len() + 1 + value.len();
        if "Cookie: ".len() + header.len() + additional_len > MAX_ACCESS_COOKIE_HEADER_BYTES {
            return None;
        }
        if !header.is_empty() {
            header.push_str("; ");
        }
        header.push_str(name);
        header.push('=');
        header.push_str(value);
    }
    (!header.is_empty()).then_some(header)
}

fn legacy_session_cookie_header<'a>(
    request_path: &str,
    cookies: impl IntoIterator<Item = (&'a str, &'a str, Option<&'a str>)>,
) -> Option<String> {
    cookie_header_for_names(
        request_path,
        &[
            "ds_session",
            "CF_Authorization",
            "CF_Session",
            "CF_AppSession",
        ],
        Some("ds_session"),
        cookies,
    )
}

pub(crate) fn cloudflare_access_cookie_header_for_stream<R: Runtime>(
    window: &WebviewWindow<R>,
    target_url: &str,
) -> Option<String> {
    let target_url = target_url.parse::<tauri::Url>().ok()?;
    let page_url = window.url().ok()?;
    if !same_http_origin(&page_url, &target_url) {
        return None;
    }
    let request_path = target_url.path().to_string();
    let cookies = window.cookies_for_url(target_url).ok()?;
    cloudflare_access_cookie_header(
        &request_path,
        cookies
            .iter()
            .map(|cookie| (cookie.name(), cookie.value(), cookie.path())),
    )
}

fn is_loopback_web_origin(url: &tauri::Url) -> bool {
    matches!(
        url.host_str(),
        Some("localhost" | "tauri.localhost" | "127.0.0.1" | "::1")
    )
}

pub(crate) fn legacy_playback_for_window<R: Runtime>(
    window: &WebviewWindow<R>,
    url: &str,
) -> Result<Option<AuthenticatedPlayback>, String> {
    let Some(target_url) = server_playback_url(url)? else {
        return Ok(None);
    };
    let page_url = window
        .url()
        .map_err(|_| "legacy playback session is not available".to_string())?;
    if !same_http_origin(&page_url, &target_url)
        || is_trusted_bundled_app_origin(&page_url)
        || is_loopback_web_origin(&page_url)
        || is_loopback_web_origin(&target_url)
    {
        return Err("legacy playback session is not available".to_string());
    }
    let request_path = target_url.path().to_string();
    let cookies = window
        .cookies_for_url(target_url)
        .map_err(|_| "legacy playback session is not available".to_string())?;
    let cookie_header = legacy_session_cookie_header(
        &request_path,
        cookies
            .iter()
            .map(|cookie| (cookie.name(), cookie.value(), cookie.path())),
    )
    .ok_or_else(|| "legacy playback session is not available".to_string())?;
    Ok(Some(AuthenticatedPlayback {
        target_url: url.to_string(),
        authentication: PlaybackAuthentication::LegacySession { cookie_header },
    }))
}

pub(crate) fn authenticated_playback_for_window<R: Runtime>(
    window: &WebviewWindow<R>,
    url: &str,
    authorization: Option<&str>,
) -> Result<Option<AuthenticatedPlayback>, String> {
    if authorization.is_none() {
        return legacy_playback_for_window(window, url);
    }
    let authorization = validate_stream_authorization(url, authorization)?
        .expect("supplied authorization validated as present");
    let target_url = url
        .parse::<tauri::Url>()
        .map_err(|_| "authenticated playback origin is not allowed".to_string())?;
    let page_url = window
        .url()
        .map_err(|_| "authenticated playback origin is not allowed".to_string())?;
    validate_authenticated_origin(&page_url, &target_url)?;
    // Cookie-store access happens only after the URL, bearer, and exact invoking
    // window origin have passed validation.
    let cookie_header = cloudflare_access_cookie_header_for_stream(window, url);
    Ok(Some(AuthenticatedPlayback {
        target_url: url.to_string(),
        authentication: PlaybackAuthentication::Bearer {
            authorization,
            cookie_header,
        },
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    const STREAM: &str =
        "https://db.tgk30.com/yawf/api/stream/stream_0123456789abcdef0123456789abcdef";

    fn authorization() -> String {
        format!("Bearer {}", "A_-z0".repeat(8) + "ABC")
    }

    #[test]
    fn validates_exact_server_stream_url_and_bearer_shape() {
        let auth = authorization();
        assert_eq!(
            validate_stream_authorization(STREAM, Some(&auth)),
            Ok(Some(auth.clone()))
        );
        assert_eq!(
            validate_stream_authorization("file:///tmp/video.mkv", None),
            Ok(None)
        );
        for rejected in [
            "https://db.tgk30.com/api/stream/stream_0123456789abcdef0123456789abcde",
            "https://db.tgk30.com/api/stream/stream_0123456789abcdef0123456789abcdeg",
            "https://db.tgk30.com/api/stream/stream_0123456789ABCDEF0123456789ABCDEF",
            "https://db.tgk30.com/api/stream/stream_0123456789abcdef0123456789abcdef/more",
            "https://db.tgk30.com/api/stream/stream_0123456789abcdef0123456789abcdef?q=1",
            "https://db.tgk30.com/api/stream/stream_0123456789abcdef0123456789abcdef#part",
            "https://user@db.tgk30.com/api/stream/stream_0123456789abcdef0123456789abcdef",
            "file:///api/stream/stream_0123456789abcdef0123456789abcdef",
        ] {
            assert!(
                validate_stream_authorization(rejected, Some(&auth)).is_err(),
                "{rejected}"
            );
        }
        for rejected in [
            "Basic abc",
            "Bearer short",
            &format!("Bearer {}", "A".repeat(42)),
            &format!("Bearer {}", "A".repeat(44)),
            &format!("Bearer {}!", "A".repeat(42)),
        ] {
            assert!(validate_stream_authorization(STREAM, Some(rejected)).is_err());
        }
    }

    #[test]
    fn strict_server_recognition_does_not_depend_on_a_bearer() {
        assert!(server_playback_url(STREAM).unwrap().is_some());
        for url in [
            "https://db.tgk30.com/api/stream/stream_bad",
            "https://db.tgk30.com/api/stream/stream_0123456789abcdef0123456789abcdef/more",
            "https://db.tgk30.com/api/stream/stream_0123456789abcdef0123456789abcdef?q=1",
            "https://example.test/video.mkv",
        ] {
            assert!(!matches!(server_playback_url(url), Ok(Some(_))));
        }
        assert!(validate_stream_authorization(
            "https://db.tgk30.com/api/stream/stream_0123456789abcdef0123456789abcdef?q=1",
            None,
        )
        .is_err());
        assert!(validate_stream_authorization(STREAM, Some("Bearer invalid")).is_err());
    }

    #[test]
    fn origins_require_exact_http_scheme_host_and_effective_port() {
        let target = tauri::Url::parse(STREAM).unwrap();
        for page in ["https://db.tgk30.com/", "https://db.tgk30.com:443/watch"] {
            let page = tauri::Url::parse(page).unwrap();
            assert!(same_http_origin(&page, &target));
            assert_eq!(validate_authenticated_origin(&page, &target), Ok(()));
        }
        for page in [
            "http://db.tgk30.com/",
            "https://db.tgk30.com:444/",
            "https://evil.example/",
        ] {
            let page = tauri::Url::parse(page).unwrap();
            assert!(!same_http_origin(&page, &target));
            assert_eq!(
                validate_authenticated_origin(&page, &target),
                Err("authenticated playback origin is not allowed".to_string())
            );
        }
    }

    #[test]
    fn bundled_app_origins_can_proxy_without_trusting_generic_loopback_pages() {
        let target = tauri::Url::parse(STREAM).unwrap();
        for page in [
            "tauri://localhost/",
            "tauri://localhost/watch/episode",
            "http://tauri.localhost/",
            "http://tauri.localhost:80/watch/episode",
        ] {
            let page = tauri::Url::parse(page).unwrap();
            assert!(is_trusted_bundled_app_origin(&page), "{page}");
            assert_eq!(validate_authenticated_origin(&page, &target), Ok(()));
            assert!(
                !same_http_origin(&page, &target),
                "trusted bundled origins must not become cookie-export origins"
            );
        }

        for page in [
            "http://localhost/",
            "http://localhost:5173/",
            "http://127.0.0.1/",
            "https://tauri.localhost/",
            "http://tauri.localhost:8080/",
            "https://remote.example/",
        ] {
            let page = tauri::Url::parse(page).unwrap();
            assert!(!is_trusted_bundled_app_origin(&page), "{page}");
            assert_eq!(
                validate_authenticated_origin(&page, &target),
                Err("authenticated playback origin is not allowed".to_string())
            );
        }
    }

    #[test]
    fn cookies_are_filtered_path_matched_bounded_and_deterministic() {
        let request = "/yawf/api/stream/stream_0123456789abcdef0123456789abcdef";
        let cookies = [
            ("ds_session", "never", Some("/")),
            ("CF_Authorization", "root", Some("/")),
            ("CF_Authorization", "yawf", Some("/yawf")),
            ("CF_Session", "wrong", Some("/yaw")),
            ("CF_Session", "valid", Some("/yawf/api")),
            ("CF_AppSession", "bad;injected=yes", Some("/")),
        ];
        assert_eq!(
            cloudflare_access_cookie_header(request, cookies),
            Some("CF_Authorization=yawf; CF_Session=valid".to_string())
        );
        assert!(cookie_path_matches(request, Some("/yawf")));
        assert!(!cookie_path_matches(request, Some("/yaw")));

        let oversized = "A".repeat(MAX_ACCESS_COOKIE_VALUE_BYTES + 1);
        assert_eq!(
            cloudflare_access_cookie_header(
                request,
                [("CF_Authorization", oversized.as_str(), Some("/"))]
            ),
            None
        );
        let maximum = "A".repeat(MAX_ACCESS_COOKIE_VALUE_BYTES);
        assert_eq!(
            cloudflare_access_cookie_header(
                request,
                [
                    ("CF_Authorization", maximum.as_str(), Some("/")),
                    ("CF_Session", maximum.as_str(), Some("/")),
                ]
            ),
            None
        );
    }

    #[test]
    fn legacy_cookie_header_requires_a_valid_session_and_filters_everything_else() {
        let request = "/yawf/api/stream/stream_0123456789abcdef0123456789abcdef";
        let root_session = format!("sess_{}.{}", "a".repeat(32), "A".repeat(43));
        let scoped_session = format!("sess_{}.{}", "b".repeat(32), "B_-".repeat(14) + "B");
        let cookies = [
            ("ds_session", root_session.as_str(), Some("/")),
            ("ds_session", "sess_invalid", Some("/yawf")),
            ("ds_session", scoped_session.as_str(), Some("/yawf/api")),
            ("CF_Session", "access", Some("/yawf")),
            ("other", "never", Some("/")),
        ];
        assert_eq!(
            legacy_session_cookie_header(request, cookies),
            Some(format!("ds_session={scoped_session}; CF_Session=access"))
        );
        assert_eq!(
            legacy_session_cookie_header(request, [("ds_session", "sess_invalid", Some("/"))]),
            None
        );
    }
}
