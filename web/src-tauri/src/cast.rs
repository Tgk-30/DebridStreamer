//! DLNA/UPnP MediaRenderer discovery and control.
//!
//! The desktop app is only the controller. It gives the renderer the public
//! debrid stream URL and never proxies the media. Local downloaded files are
//! intentionally outside this MVP because they need a local HTTP media server.

use reqwest::blocking::{Client, Response};
use roxmltree::Document;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::io::Read;
use std::net::UdpSocket;
use std::time::{Duration, Instant};

const SSDP_TARGET: &str = "239.255.255.250:1900";
const SSDP_ST: &str = "urn:schemas-upnp-org:device:MediaRenderer:1";
const AV_TRANSPORT: &str = "urn:schemas-upnp-org:service:AVTransport:1";
const RENDERING_CONTROL: &str = "urn:schemas-upnp-org:service:RenderingControl:1";
const AV_TRANSPORT_PREFIX: &str = "urn:schemas-upnp-org:service:AVTransport:";
const RENDERING_CONTROL_PREFIX: &str = "urn:schemas-upnp-org:service:RenderingControl:";
const DEFAULT_DISCOVERY_MS: u64 = 2_500;
const MAX_DISCOVERY_MS: u64 = 10_000;
const HTTP_TIMEOUT: Duration = Duration::from_secs(3);
const MAX_RESPONSE_BYTES: u64 = 1_048_576;
const MAX_DESCRIPTION_LOCATIONS: usize = 32;

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CastDevice {
    pub id: String,
    pub name: String,
    pub av_control_url: String,
    pub rendering_control_url: Option<String>,
    pub location: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CastStatus {
    pub state: String,
    pub position_secs: u64,
    pub duration_secs: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CastLoadArgs {
    device: CastDevice,
    url: String,
    title: String,
    subtitle_url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CastControlArgs {
    device: CastDevice,
    action: String,
    position_secs: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CastVolumeArgs {
    device: CastDevice,
    level: u8,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct SsdpHit {
    location: String,
}

/// Extract a LOCATION header from an SSDP response without trusting its shape.
fn parse_ssdp_response(response: &str) -> Option<SsdpHit> {
    response.lines().find_map(|line| {
        let (name, value) = line.split_once(':')?;
        if !name.trim().eq_ignore_ascii_case("location") {
            return None;
        }
        let location = value.trim();
        if location.is_empty() {
            None
        } else {
            Some(SsdpHit {
                location: location.to_string(),
            })
        }
    })
}

fn element_text(document: &Document<'_>, name: &str) -> Option<String> {
    node_text(document.root(), name)
}

fn node_text(root: roxmltree::Node<'_, '_>, name: &str) -> Option<String> {
    root.descendants()
        .find(|node| node.is_element() && node.tag_name().name() == name)
        .and_then(|node| node.text())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn service_type(service: roxmltree::Node<'_, '_>) -> Option<String> {
    service
        .children()
        .find(|node| node.is_element() && node.tag_name().name() == "serviceType")
        .and_then(|node| node.text())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn service_control_url(root: roxmltree::Node<'_, '_>, service_prefix: &str) -> Option<String> {
    root.descendants()
        .filter(|node| node.is_element() && node.tag_name().name() == "service")
        .find_map(|service| {
            if !service_type(service)?.starts_with(service_prefix) {
                return None;
            }
            service
                .children()
                .find(|node| node.is_element() && node.tag_name().name() == "controlURL")
                .and_then(|node| node.text())
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        })
}

fn resolve_control_url(base: &reqwest::Url, control_url: &str) -> Option<String> {
    base.join(control_url).ok().map(|url| url.to_string())
}

/// Parse a UPnP device description and resolve its service control URLs.
fn parse_device_description(xml: &str, base_url: &str) -> Option<CastDevice> {
    let document = Document::parse(xml).ok()?;
    let description_url = reqwest::Url::parse(base_url).ok()?;
    let url_base = element_text(&document, "URLBase")
        .and_then(|value| reqwest::Url::parse(&value).ok())
        .unwrap_or(description_url);
    let av_service = document
        .descendants()
        .filter(|node| node.is_element() && node.tag_name().name() == "service")
        .find(|service| {
            service_type(*service).is_some_and(|value| value.starts_with(AV_TRANSPORT_PREFIX))
        })?;
    let renderer = av_service
        .ancestors()
        .find(|node| node.is_element() && node.tag_name().name() == "device")?;
    let av_path = service_control_url(renderer, AV_TRANSPORT_PREFIX)?;
    let rendering_path = service_control_url(renderer, RENDERING_CONTROL_PREFIX);
    let id = node_text(renderer, "UDN")?;
    let name = node_text(renderer, "friendlyName")?;

    Some(CastDevice {
        id,
        name,
        av_control_url: resolve_control_url(&url_base, &av_path)?,
        rendering_control_url: rendering_path
            .as_deref()
            .and_then(|path| resolve_control_url(&url_base, path)),
        location: base_url.to_string(),
    })
}

fn xml_escape(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for character in value.chars() {
        match character {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '"' => escaped.push_str("&quot;"),
            '\'' => escaped.push_str("&apos;"),
            _ => escaped.push(character),
        }
    }
    escaped
}

/// Build the DIDL-Lite metadata sent with SetAVTransportURI.
fn build_didl(url: &str, title: &str, subtitle_url: Option<&str>) -> String {
    let escaped_url = xml_escape(url);
    let escaped_title = xml_escape(title);
    let subtitle_attributes = subtitle_url
        .map(|subtitle| {
            let escaped = xml_escape(subtitle);
            format!(" sec:CaptionInfoEx=\"{escaped}\" pv:subtitleFileUri=\"{escaped}\"")
        })
        .unwrap_or_default();
    let subtitle_resource = subtitle_url
        .map(|subtitle| {
            format!(
                "<res protocolInfo=\"http-get:*:text/srt:*\">{}</res>",
                xml_escape(subtitle)
            )
        })
        .unwrap_or_default();

    format!(
        "<DIDL-Lite xmlns=\"urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/\" \
         xmlns:dc=\"http://purl.org/dc/elements/1.1/\" \
         xmlns:upnp=\"urn:schemas-upnp-org:metadata-1-0/upnp/\" \
         xmlns:sec=\"http://www.sec.co.kr/\" \
         xmlns:pv=\"http://www.pv.com/pvns/\">\
         <item id=\"0\" parentID=\"0\" restricted=\"1\">\
         <dc:title>{escaped_title}</dc:title>\
         <upnp:class>object.item.videoItem</upnp:class>\
         <res protocolInfo=\"http-get:*:*:*\"{subtitle_attributes}>{escaped_url}</res>\
         {subtitle_resource}</item></DIDL-Lite>"
    )
}

/// Build a SOAP 1.1 request envelope. Argument names are internal constants;
/// all argument values are escaped here.
fn soap_envelope(service: &str, action: &str, body_args: &[(&str, &str)]) -> String {
    let mut arguments = String::new();
    for (name, value) in body_args {
        arguments.push('<');
        arguments.push_str(name);
        arguments.push('>');
        arguments.push_str(&xml_escape(value));
        arguments.push_str("</");
        arguments.push_str(name);
        arguments.push('>');
    }
    format!(
        "<?xml version=\"1.0\" encoding=\"utf-8\"?>\
         <s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" \
         s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\">\
         <s:Body><u:{action} xmlns:u=\"{service}\">{arguments}</u:{action}></s:Body>\
         </s:Envelope>"
    )
}

fn secs_to_hms(seconds: u64) -> String {
    let hours = seconds / 3_600;
    let minutes = (seconds % 3_600) / 60;
    let seconds = seconds % 60;
    format!("{hours:02}:{minutes:02}:{seconds:02}")
}

fn hms_to_secs(value: &str) -> Option<u64> {
    let mut parts = value.trim().split(':');
    let hours = parts.next()?.parse::<u64>().ok()?;
    let minutes = parts.next()?.parse::<u64>().ok()?;
    let seconds_text = parts.next()?;
    if parts.next().is_some() || minutes > 59 {
        return None;
    }
    let seconds = seconds_text.split('.').next()?.parse::<u64>().ok()?;
    if seconds > 59 {
        return None;
    }
    hours
        .checked_mul(3_600)?
        .checked_add(minutes.checked_mul(60)?)?
        .checked_add(seconds)
}

fn parse_position_info(xml: &str) -> Result<(u64, u64), String> {
    let document =
        Document::parse(xml).map_err(|error| format!("Invalid position XML: {error}"))?;
    let parse_time = |name: &str| -> Result<u64, String> {
        let value = element_text(&document, name)
            .ok_or_else(|| format!("Position response did not contain {name}"))?;
        if value.eq_ignore_ascii_case("NOT_IMPLEMENTED") {
            return Ok(0);
        }
        hms_to_secs(&value)
            .ok_or_else(|| format!("Position response did not contain a valid {name}"))
    };
    let position = parse_time("RelTime")?;
    let duration = parse_time("TrackDuration")?;
    Ok((position, duration))
}

fn parse_transport_info(xml: &str) -> Result<String, String> {
    let document =
        Document::parse(xml).map_err(|error| format!("Invalid transport XML: {error}"))?;
    element_text(&document, "CurrentTransportState")
        .ok_or_else(|| "Transport response did not contain CurrentTransportState".to_string())
}

fn build_http_client() -> Result<Client, String> {
    Client::builder()
        .connect_timeout(Duration::from_secs(2))
        .timeout(HTTP_TIMEOUT)
        .build()
        .map_err(|error| format!("Could not create DLNA HTTP client: {error}"))
}

fn read_limited(mut response: Response) -> Result<String, String> {
    let status = response.status();
    let mut bytes = Vec::new();
    response
        .by_ref()
        .take(MAX_RESPONSE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("Could not read renderer response: {error}"))?;
    if bytes.len() as u64 > MAX_RESPONSE_BYTES {
        return Err("Renderer response exceeded the 1 MiB safety limit".to_string());
    }
    if !status.is_success() {
        return Err(format!("Renderer returned HTTP {status}"));
    }
    String::from_utf8(bytes).map_err(|_| "Renderer response was not valid UTF-8".to_string())
}

fn soap_fault(xml: &str) -> Option<String> {
    if xml.trim().is_empty() {
        return None;
    }
    let document = Document::parse(xml).ok()?;
    document
        .descendants()
        .find(|node| node.is_element() && node.tag_name().name() == "faultstring")
        .and_then(|node| node.text())
        .map(str::trim)
        .filter(|message| !message.is_empty())
        .map(str::to_string)
}

fn soap_post(
    client: &Client,
    control_url: &str,
    service: &str,
    action: &str,
    arguments: &[(&str, &str)],
) -> Result<String, String> {
    let envelope = soap_envelope(service, action, arguments);
    let response = client
        .post(control_url)
        .header("Content-Type", "text/xml; charset=\"utf-8\"")
        .header("SOAPAction", format!("\"{service}#{action}\""))
        .timeout(HTTP_TIMEOUT)
        .body(envelope)
        .send()
        .map_err(|error| format!("DLNA {action} request failed: {error}"))?;
    let body = read_limited(response)?;
    if let Some(fault) = soap_fault(&body) {
        return Err(format!("DLNA {action} failed: {fault}"));
    }
    Ok(body)
}

fn discover_locations(timeout_ms: u64) -> Result<Vec<String>, String> {
    let timeout_ms = if timeout_ms == 0 {
        DEFAULT_DISCOVERY_MS
    } else {
        timeout_ms.min(MAX_DISCOVERY_MS)
    };
    let timeout = Duration::from_millis(timeout_ms);
    let socket = UdpSocket::bind("0.0.0.0:0")
        .map_err(|error| format!("Could not bind SSDP discovery socket: {error}"))?;
    socket
        .set_write_timeout(Some(Duration::from_secs(1)))
        .map_err(|error| format!("Could not configure SSDP send timeout: {error}"))?;
    let request = format!(
        "M-SEARCH * HTTP/1.1\r\nHOST: {SSDP_TARGET}\r\nMAN: \"ssdp:discover\"\r\nMX: 2\r\nST: {SSDP_ST}\r\n\r\n"
    );
    socket
        .send_to(request.as_bytes(), SSDP_TARGET)
        .map_err(|error| format!("Could not send SSDP discovery request: {error}"))?;

    let deadline = Instant::now() + timeout;
    let mut locations = Vec::new();
    let mut seen = HashSet::new();
    let mut buffer = [0_u8; 65_535];
    loop {
        let now = Instant::now();
        if now >= deadline || locations.len() >= MAX_DESCRIPTION_LOCATIONS {
            break;
        }
        socket
            .set_read_timeout(Some(deadline.saturating_duration_since(now)))
            .map_err(|error| format!("Could not configure SSDP receive timeout: {error}"))?;
        match socket.recv_from(&mut buffer) {
            Ok((length, _)) => {
                let response = String::from_utf8_lossy(&buffer[..length]);
                if let Some(hit) = parse_ssdp_response(&response) {
                    if seen.insert(hit.location.clone()) {
                        locations.push(hit.location);
                    }
                }
            }
            Err(error)
                if error.kind() == std::io::ErrorKind::WouldBlock
                    || error.kind() == std::io::ErrorKind::TimedOut =>
            {
                break;
            }
            Err(error) => return Err(format!("SSDP discovery receive failed: {error}")),
        }
    }
    Ok(locations)
}

fn cast_discover_blocking(timeout_ms: u64) -> Result<Vec<CastDevice>, String> {
    let locations = discover_locations(timeout_ms)?;
    let client = build_http_client()?;
    let mut devices = Vec::new();
    let mut seen_udns = HashSet::new();

    for location in locations {
        let response = match client.get(&location).timeout(HTTP_TIMEOUT).send() {
            Ok(response) => response,
            Err(_) => continue,
        };
        let xml = match read_limited(response) {
            Ok(xml) => xml,
            Err(_) => continue,
        };
        let Some(device) = parse_device_description(&xml, &location) else {
            continue;
        };
        if seen_udns.insert(device.id.clone()) {
            devices.push(device);
        }
    }
    devices.sort_by(|left, right| {
        left.name
            .to_lowercase()
            .cmp(&right.name.to_lowercase())
            .then_with(|| left.id.cmp(&right.id))
    });
    Ok(devices)
}

fn cast_load_blocking(args: CastLoadArgs) -> Result<(), String> {
    let stream_url = reqwest::Url::parse(&args.url)
        .map_err(|error| format!("Invalid cast stream URL: {error}"))?;
    if stream_url.scheme() != "http" && stream_url.scheme() != "https" {
        return Err("Cast stream URL must use HTTP or HTTPS".to_string());
    }
    let client = build_http_client()?;
    let didl = build_didl(&args.url, &args.title, args.subtitle_url.as_deref());
    soap_post(
        &client,
        &args.device.av_control_url,
        AV_TRANSPORT,
        "SetAVTransportURI",
        &[
            ("InstanceID", "0"),
            ("CurrentURI", &args.url),
            ("CurrentURIMetaData", &didl),
        ],
    )?;
    soap_post(
        &client,
        &args.device.av_control_url,
        AV_TRANSPORT,
        "Play",
        &[("InstanceID", "0"), ("Speed", "1")],
    )?;
    Ok(())
}

fn cast_control_blocking(args: CastControlArgs) -> Result<(), String> {
    let client = build_http_client()?;
    match args.action.as_str() {
        "play" => {
            soap_post(
                &client,
                &args.device.av_control_url,
                AV_TRANSPORT,
                "Play",
                &[("InstanceID", "0"), ("Speed", "1")],
            )?;
        }
        "pause" => {
            soap_post(
                &client,
                &args.device.av_control_url,
                AV_TRANSPORT,
                "Pause",
                &[("InstanceID", "0")],
            )?;
        }
        "stop" => {
            soap_post(
                &client,
                &args.device.av_control_url,
                AV_TRANSPORT,
                "Stop",
                &[("InstanceID", "0")],
            )?;
        }
        "seek" => {
            let position = args
                .position_secs
                .ok_or_else(|| "Seek requires positionSecs".to_string())?;
            let target = secs_to_hms(position);
            soap_post(
                &client,
                &args.device.av_control_url,
                AV_TRANSPORT,
                "Seek",
                &[
                    ("InstanceID", "0"),
                    ("Unit", "REL_TIME"),
                    ("Target", &target),
                ],
            )?;
        }
        _ => return Err("Cast action must be play, pause, stop, or seek".to_string()),
    }
    Ok(())
}

fn cast_status_blocking(device: CastDevice) -> Result<CastStatus, String> {
    let client = build_http_client()?;
    let position_xml = soap_post(
        &client,
        &device.av_control_url,
        AV_TRANSPORT,
        "GetPositionInfo",
        &[("InstanceID", "0")],
    )?;
    let transport_xml = soap_post(
        &client,
        &device.av_control_url,
        AV_TRANSPORT,
        "GetTransportInfo",
        &[("InstanceID", "0")],
    )?;
    let (position_secs, duration_secs) = parse_position_info(&position_xml)?;
    let state = parse_transport_info(&transport_xml)?;
    Ok(CastStatus {
        state,
        position_secs,
        duration_secs,
    })
}

fn cast_set_volume_blocking(args: CastVolumeArgs) -> Result<(), String> {
    if args.level > 100 {
        return Err("Cast volume must be between 0 and 100".to_string());
    }
    let Some(control_url) = args.device.rendering_control_url.as_deref() else {
        return Ok(());
    };
    let client = build_http_client()?;
    let desired_volume = args.level.to_string();
    soap_post(
        &client,
        control_url,
        RENDERING_CONTROL,
        "SetVolume",
        &[
            ("InstanceID", "0"),
            ("Channel", "Master"),
            ("DesiredVolume", &desired_volume),
        ],
    )?;
    Ok(())
}

#[tauri::command]
pub async fn cast_discover(timeout_ms: u64) -> Result<Vec<CastDevice>, String> {
    tokio::task::spawn_blocking(move || cast_discover_blocking(timeout_ms))
        .await
        .map_err(|error| format!("Cast discovery task failed: {error}"))?
}

#[tauri::command]
pub async fn cast_load(args: CastLoadArgs) -> Result<(), String> {
    tokio::task::spawn_blocking(move || cast_load_blocking(args))
        .await
        .map_err(|error| format!("Cast load task failed: {error}"))?
}

#[tauri::command]
pub async fn cast_control(args: CastControlArgs) -> Result<(), String> {
    tokio::task::spawn_blocking(move || cast_control_blocking(args))
        .await
        .map_err(|error| format!("Cast control task failed: {error}"))?
}

#[tauri::command]
pub async fn cast_status(device: CastDevice) -> Result<CastStatus, String> {
    tokio::task::spawn_blocking(move || cast_status_blocking(device))
        .await
        .map_err(|error| format!("Cast status task failed: {error}"))?
}

#[tauri::command]
pub async fn cast_set_volume(args: CastVolumeArgs) -> Result<(), String> {
    tokio::task::spawn_blocking(move || cast_set_volume_blocking(args))
        .await
        .map_err(|error| format!("Cast volume task failed: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    const SONY_DESCRIPTION: &str = r#"<?xml version="1.0"?>
<root xmlns="urn:schemas-upnp-org:device-1-0">
  <URLBase>http://192.168.1.40:52323/base/</URLBase>
  <device>
    <deviceType>urn:schemas-upnp-org:device:MediaRenderer:1</deviceType>
    <friendlyName>BRAVIA XR Living Room</friendlyName>
    <UDN>uuid:sony-bravia-123</UDN>
    <serviceList>
      <service>
        <serviceType>urn:schemas-upnp-org:service:RenderingControl:1</serviceType>
        <serviceId>urn:upnp-org:serviceId:RenderingControl</serviceId>
        <controlURL>/upnp/control/RenderingControl1</controlURL>
      </service>
      <service>
        <serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType>
        <serviceId>urn:upnp-org:serviceId:AVTransport</serviceId>
        <controlURL>control/AVTransport1</controlURL>
      </service>
    </serviceList>
  </device>
</root>"#;

    const MINIMAL_DESCRIPTION: &str = r#"<root><device>
<friendlyName>LG webOS TV</friendlyName><UDN>uuid:lg-tv-9</UDN>
<serviceList><service>
<serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType>
<controlURL>/MediaRenderer/AVTransport/Control</controlURL>
</service></serviceList></device></root>"#;

    const POSITION_RESPONSE: &str = r#"<?xml version="1.0"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
 <s:Body><u:GetPositionInfoResponse xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
  <Track>1</Track><TrackDuration>01:42:07</TrackDuration><RelTime>00:12:34</RelTime>
 </u:GetPositionInfoResponse></s:Body>
</s:Envelope>"#;

    const TRANSPORT_RESPONSE: &str = r#"<?xml version="1.0"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
 <s:Body><u:GetTransportInfoResponse xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
  <CurrentTransportState>PLAYING</CurrentTransportState>
  <CurrentTransportStatus>OK</CurrentTransportStatus>
 </u:GetTransportInfoResponse></s:Body>
</s:Envelope>"#;

    #[test]
    fn parses_well_formed_ssdp_location_case_insensitively() {
        let response = "HTTP/1.1 200 OK\r\nCACHE-CONTROL: max-age=1800\r\nLocation: http://192.168.1.40:52323/dmr.xml\r\nST: urn:schemas-upnp-org:device:MediaRenderer:1\r\n\r\n";
        assert_eq!(
            parse_ssdp_response(response),
            Some(SsdpHit {
                location: "http://192.168.1.40:52323/dmr.xml".to_string()
            })
        );
    }

    #[test]
    fn skips_ssdp_without_location_or_with_junk() {
        assert_eq!(
            parse_ssdp_response("HTTP/1.1 200 OK\r\nST: renderer\r\n"),
            None
        );
        assert_eq!(parse_ssdp_response("not even an HTTP response"), None);
        assert_eq!(parse_ssdp_response("LOCATION:   \r\n"), None);
    }

    #[test]
    fn parses_renderer_description_and_resolves_url_base() {
        let device =
            parse_device_description(SONY_DESCRIPTION, "http://192.168.1.40:52323/device/dmr.xml");
        assert_eq!(
            device.as_ref().map(|value| value.name.as_str()),
            Some("BRAVIA XR Living Room")
        );
        assert_eq!(
            device.as_ref().map(|value| value.id.as_str()),
            Some("uuid:sony-bravia-123")
        );
        assert_eq!(
            device.as_ref().map(|value| value.av_control_url.as_str()),
            Some("http://192.168.1.40:52323/base/control/AVTransport1")
        );
        assert_eq!(
            device
                .as_ref()
                .and_then(|value| value.rendering_control_url.as_deref()),
            Some("http://192.168.1.40:52323/upnp/control/RenderingControl1")
        );
    }

    #[test]
    fn parses_minimal_service_only_description_against_location() {
        let device = parse_device_description(
            MINIMAL_DESCRIPTION,
            "http://10.0.0.18:8080/description/device.xml",
        );
        assert_eq!(
            device.as_ref().map(|value| value.name.as_str()),
            Some("LG webOS TV")
        );
        assert_eq!(
            device.as_ref().map(|value| value.av_control_url.as_str()),
            Some("http://10.0.0.18:8080/MediaRenderer/AVTransport/Control")
        );
        assert_eq!(device.and_then(|value| value.rendering_control_url), None);
    }

    #[test]
    fn rejects_malformed_or_incomplete_descriptions() {
        assert_eq!(
            parse_device_description("<root><device>", "http://10.0.0.1/device.xml"),
            None
        );
        assert_eq!(
            parse_device_description(
                "<root><friendlyName>No services</friendlyName><UDN>uuid:x</UDN></root>",
                "http://10.0.0.1/device.xml"
            ),
            None
        );
    }

    #[test]
    fn didl_contains_media_subtitle_hints_and_escapes_every_value() {
        let didl = build_didl(
            "https://cdn.example/video?a=1&b=<two>",
            "A & B <C> \"D\" 'E'",
            Some("https://sub.example/file.srt?a=1&b=2"),
        );
        assert!(didl.contains("A &amp; B &lt;C&gt; &quot;D&quot; &apos;E&apos;"));
        assert!(didl.contains("https://cdn.example/video?a=1&amp;b=&lt;two&gt;"));
        assert!(didl.contains("sec:CaptionInfoEx=\"https://sub.example/file.srt?a=1&amp;b=2\""));
        assert!(didl.contains("pv:subtitleFileUri=\"https://sub.example/file.srt?a=1&amp;b=2\""));
        assert!(didl.contains("protocolInfo=\"http-get:*:text/srt:*\""));
        assert!(Document::parse(&didl).is_ok());
    }

    #[test]
    fn soap_envelope_uses_service_action_and_escaped_arguments() {
        let envelope = soap_envelope(
            AV_TRANSPORT,
            "SetAVTransportURI",
            &[
                ("InstanceID", "0"),
                ("CurrentURI", "https://x.test/a?x=1&y=<2>"),
            ],
        );
        assert!(envelope.contains(&format!("<u:SetAVTransportURI xmlns:u=\"{AV_TRANSPORT}\">")));
        assert!(envelope.contains("<InstanceID>0</InstanceID>"));
        assert!(envelope.contains("https://x.test/a?x=1&amp;y=&lt;2&gt;"));
        assert!(Document::parse(&envelope).is_ok());
    }

    #[test]
    fn hms_conversion_round_trips_and_rejects_invalid_values() {
        for seconds in [0, 59, 60, 3_661, 359_999] {
            assert_eq!(hms_to_secs(&secs_to_hms(seconds)), Some(seconds));
        }
        assert_eq!(secs_to_hms(3_661), "01:01:01");
        assert_eq!(hms_to_secs("01:02:03.500"), Some(3_723));
        assert_eq!(hms_to_secs("01:60:00"), None);
        assert_eq!(hms_to_secs("junk"), None);
    }

    #[test]
    fn parses_real_position_and_transport_responses() {
        assert_eq!(parse_position_info(POSITION_RESPONSE), Ok((754, 6_127)));
        assert_eq!(
            parse_transport_info(TRANSPORT_RESPONSE),
            Ok("PLAYING".to_string())
        );
        assert_eq!(
            parse_position_info(
                "<root><RelTime>NOT_IMPLEMENTED</RelTime><TrackDuration>00:00:00</TrackDuration></root>"
            ),
            Ok((0, 0))
        );
    }

    #[test]
    fn soap_response_parsers_reject_malformed_or_missing_fields() {
        assert!(parse_position_info("<broken>").is_err());
        assert!(parse_position_info("<root><RelTime>00:00:01</RelTime></root>").is_err());
        assert!(parse_transport_info("<root />").is_err());
    }
}
