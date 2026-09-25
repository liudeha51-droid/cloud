// The whole app lives in ../app (plain HTML/JS). Tauri just hosts it in a native
// webview on Windows, Linux (incl. SteamOS), macOS, Android and iOS.
// 整个应用都在 ../app 目录中（纯 HTML/JS）。Tauri 只负责把它放进原生 WebView 中运行，
// 支持 Windows、Linux（含 SteamOS）、macOS、Android 和 iOS。

use std::collections::HashMap;

// What the page needs to pick its SteamOS / handheld profile (see app/js/platform.js).
// Only hardware model names and OS ids — nothing personal.
// 页面选择 SteamOS / 掌机配置所需的信息（见 app/js/platform.js）。
// 只有硬件型号和系统标识，不含任何个人信息。
#[derive(serde::Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct PlatformInfo {
    target: &'static str,
    os_id: String,
    os_id_like: String,
    os_variant: String,
    os_version: String,
    os_name: String,
    board: String,
    product: String,
    product_version: String,
    vendor: String,
    game_mode: bool,
    steam_deck: bool,
}

fn env_is(key: &str, want: &str) -> bool {
    std::env::var(key).map(|v| v.eq_ignore_ascii_case(want)).unwrap_or(false)
}

// Steam's Gaming Mode runs apps inside gamescope and sets SteamGamepadUI for everything it launches.
// Steam 的游戏模式在 gamescope 中运行应用，并为它启动的所有程序设置 SteamGamepadUI。
fn in_game_mode() -> bool {
    env_is("SteamGamepadUI", "1")
        || std::env::var_os("GAMESCOPE_WAYLAND_DISPLAY").is_some()
        || env_is("XDG_CURRENT_DESKTOP", "gamescope")
}

#[cfg(target_os = "linux")]
fn read_trim(path: &str) -> String {
    std::fs::read_to_string(path).map(|s| s.trim().to_string()).unwrap_or_default()
}

// Parse /etc/os-release (KEY=value, optionally quoted). / 解析 /etc/os-release（KEY=value，值可带引号）。
#[cfg(target_os = "linux")]
fn os_release() -> HashMap<String, String> {
    let text = std::fs::read_to_string("/etc/os-release")
        .or_else(|_| std::fs::read_to_string("/usr/lib/os-release"))
        .unwrap_or_default();
    text.lines()
        .filter_map(|l| l.split_once('='))
        .map(|(k, v)| (k.trim().to_string(), v.trim().trim_matches('"').trim_matches('\'').to_string()))
        .collect()
}

#[cfg(not(target_os = "linux"))]
fn os_release() -> HashMap<String, String> {
    HashMap::new()
}

#[tauri::command]
fn platform_info() -> PlatformInfo {
    let mut rel = os_release();
    let mut take = |k: &str| rel.remove(k).unwrap_or_default();
    #[allow(unused_mut)]
    let mut info = PlatformInfo {
        target: std::env::consts::OS,
        os_id: take("ID"),
        os_id_like: take("ID_LIKE"),
        os_variant: take("VARIANT_ID"),
        os_version: take("VERSION_ID"),
        os_name: take("PRETTY_NAME"),
        game_mode: in_game_mode(),
        steam_deck: env_is("SteamDeck", "1"),
        ..Default::default()
    };
    // DMI names identify the handheld: Jupiter = Steam Deck LCD, Galileo = Steam Deck OLED, etc.
    // DMI 名称用于识别掌机：Jupiter = Steam Deck LCD，Galileo = Steam Deck OLED，等等。
    #[cfg(target_os = "linux")]
    {
        info.board = read_trim("/sys/class/dmi/id/board_name");
        info.product = read_trim("/sys/class/dmi/id/product_name");
        // Lenovo puts the model code in product_name ("83E1") and the name in product_version ("Legion Go 8APU1").
        // 联想把型号代码放在 product_name（"83E1"），名称放在 product_version（"Legion Go 8APU1"）。
        info.product_version = read_trim("/sys/class/dmi/id/product_version");
        info.vendor = read_trim("/sys/class/dmi/id/sys_vendor");
    }
    info
}

// Open Steam's on-screen keyboard (Gaming Mode has no system keyboard for non-Steam apps).
// Best effort: does nothing outside Steam.
// 打开 Steam 屏幕键盘（游戏模式下非 Steam 应用没有系统键盘）。尽力而为：不在 Steam 中时什么也不做。
#[tauri::command]
fn steam_keyboard() {
    #[cfg(target_os = "linux")]
    {
        use std::process::{Command, Stdio};
        let url = "steam://open/keyboard";
        let spawn = |cmd: &str| {
            Command::new(cmd).arg(url).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn()
        };
        if spawn("xdg-open").is_err() {
            let _ = spawn("steam");
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // WebKitGTK's DMA-BUF renderer shows a black/blank window under gamescope (Steam Gaming Mode).
    // Must be set before the webview starts; a value the user set themselves wins.
    // WebKitGTK 的 DMA-BUF 渲染器在 gamescope（Steam 游戏模式）下会显示黑屏/空白窗口。
    // 必须在 WebView 启动前设置；用户自己设置的值优先。
    #[cfg(target_os = "linux")]
    if in_game_mode() && std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![platform_info, steam_keyboard])
        .setup(|_app| {
            // Gaming Mode: fill the screen without window decorations. / 游戏模式：全屏，不显示窗口边框。
            #[cfg(desktop)]
            if in_game_mode() {
                use tauri::Manager;
                if let Some(w) = _app.get_webview_window("main") {
                    let _ = w.set_fullscreen(true);
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running CloudVault");
}
