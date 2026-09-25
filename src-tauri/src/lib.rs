// The whole app lives in ../app (plain HTML/JS). Tauri just hosts it in a native
// webview on Windows, Linux (incl. SteamOS), macOS, Android and iOS.
// 整个应用都在 ../app 目录中（纯 HTML/JS）。Tauri 只负责把它放进原生 WebView 中运行，
// 支持 Windows、Linux（含 SteamOS）、macOS、Android 和 iOS。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(windows)]
    portable_mode();
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running CloudVault");
}

// Portable mode (Windows): if a file named `portable.txt` sits next to the .exe, keep the
// webview profile (and so the encrypted local vault) in `CloudVault-data` beside it
// instead of %LOCALAPPDATA%, so the whole folder can live on a USB stick.
// 便携模式（Windows）：如果 .exe 旁边有 `portable.txt` 文件，就把 WebView 配置文件
// （也就是加密的本地密码库）保存在旁边的 `CloudVault-data` 文件夹中，而不是 %LOCALAPPDATA%，
// 这样整个文件夹可以放在 U 盘里随身携带。
#[cfg(windows)]
fn portable_mode() {
    let Some(dir) = std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.to_path_buf())) else {
        return;
    };
    if dir.join("portable.txt").is_file() {
        std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", dir.join("CloudVault-data"));
    }
}
