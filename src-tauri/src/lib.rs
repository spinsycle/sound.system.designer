// The desktop shell: a window around the web app, a native Save/Open dialog, file read and write for the files the user
// picks, and an HTTP client for the local Ollama server (a request from here carries no browser origin, which Ollama
// refuses for the window's own origin).
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .run(tauri::generate_context!())
        .expect("error while running Sound System Designer");
}
