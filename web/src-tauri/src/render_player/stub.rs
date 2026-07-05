// libmpv-free stub for platforms without an in-window surface yet (Windows/Linux
// until v0.6 Phases 2/3). Provides the same Tauri command surface as `core.rs`,
// but returns errors instead of touching libmpv — so the crate links on every OS
// without needing libmpv on runners that don't yet ship a surface.

use std::collections::HashMap;
use std::sync::Mutex;

use tauri::{AppHandle, Runtime, State, Window};

#[derive(Default)]
pub struct PlayerState(pub Mutex<Option<()>>);

const UNSUPPORTED: &str = "the in-window player is not available on this platform yet";

#[tauri::command]
pub fn player_init<R: Runtime>(
    _app: AppHandle<R>,
    _options: HashMap<String, String>,
    _observed: Vec<serde_json::Value>,
) -> Result<(), String> {
    Err(UNSUPPORTED.into())
}

#[tauri::command]
pub fn player_load<R: Runtime>(
    _app: AppHandle<R>,
    _window: Window<R>,
    _state: State<'_, PlayerState>,
    _url: String,
) -> Result<(), String> {
    Err(UNSUPPORTED.into())
}

#[tauri::command]
pub fn player_command(_state: State<'_, PlayerState>, _args: Vec<String>) -> Result<(), String> {
    Err(UNSUPPORTED.into())
}

#[tauri::command]
pub fn player_set_property(
    _state: State<'_, PlayerState>,
    _name: String,
    _value: String,
) -> Result<(), String> {
    Err(UNSUPPORTED.into())
}

#[tauri::command]
pub fn player_get_property(
    _state: State<'_, PlayerState>,
    _name: String,
) -> Result<serde_json::Value, String> {
    Err(UNSUPPORTED.into())
}

#[tauri::command]
pub fn player_set_video_margin(
    _state: State<'_, PlayerState>,
    _bottom: f64,
) -> Result<(), String> {
    Err(UNSUPPORTED.into())
}

#[tauri::command]
pub fn player_set_rect(
    _state: State<'_, PlayerState>,
    _x: i32,
    _y: i32,
    _width: i32,
    _height: i32,
) -> Result<(), String> {
    Err(UNSUPPORTED.into())
}

#[tauri::command]
pub fn player_destroy<R: Runtime>(
    _app: AppHandle<R>,
    _state: State<'_, PlayerState>,
) -> Result<(), String> {
    Ok(())
}
