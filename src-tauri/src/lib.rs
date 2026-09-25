// The whole app lives in ../app (plain HTML/JS). Tauri just hosts it in a native
// webview on Windows, Linux (incl. SteamOS), macOS, Android and iOS.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running CloudVault");
}
