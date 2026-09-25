// The whole app lives in ../app (plain HTML/JS). Tauri just hosts it in a native
// webview on Windows, Linux (incl. SteamOS), macOS, Android and iOS.
// 整个应用都在 ../app 目录中（纯 HTML/JS）。Tauri 只负责把它放进原生 WebView 中运行，
// 支持 Windows、Linux（含 SteamOS）、macOS、Android 和 iOS。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running CloudVault");
}
