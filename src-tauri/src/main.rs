// Prevents an extra console window on Windows in release builds.
// 在 Windows 正式版中不弹出多余的控制台窗口。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    cloudvault_lib::run()
}
