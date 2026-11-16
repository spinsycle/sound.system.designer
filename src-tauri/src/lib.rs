// The desktop shell: a window around the web app, a native Save/Open dialog, file read and write for the files the user
// picks, and an HTTP client for the local Ollama server (a request from here carries no browser origin, which Ollama
// refuses for the window's own origin).
//
// Release builds start with a Desktop / Web / Cancel prompt (`--desktop` / `--web` skip it). Web serves the embedded
// frontend on 127.0.0.1 and opens the default browser; the page pings `/__ping` every 5 s and the process exits when the
// pings stop. ponytail: single-threaded static server, GET only, no auth, loopback only; add threads if a page ever
// needs parallel loads.
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

const PING_TIMEOUT: Duration = Duration::from_secs(20);

fn serve_one(app: &AppHandle, mut s: TcpStream, pinged: &mut Option<Instant>) {
    let _ = s.set_read_timeout(Some(Duration::from_secs(2)));
    let mut buf = [0u8; 2048];
    let n = s.read(&mut buf).unwrap_or(0);
    let req = String::from_utf8_lossy(&buf[..n]);
    let mut parts = req.split_whitespace();
    let (method, target) = (parts.next().unwrap_or(""), parts.next().unwrap_or("/"));
    let path = target.split(['?', '#']).next().unwrap_or("/");
    if method != "GET" {
        let _ = s.write_all(b"HTTP/1.1 405 Method Not Allowed\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
        return;
    }
    if path == "/__ping" {
        *pinged = Some(Instant::now());
        let _ = s.write_all(b"HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n");
        return;
    }
    let asset = app.asset_resolver().get(path.to_string()).or_else(|| app.asset_resolver().get("index.html".to_string()));
    match asset.filter(|_| !path.contains("..")) {
        Some(a) => {
            let head = format!("HTTP/1.1 200 OK\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", a.mime_type, a.bytes.len());
            let _ = s.write_all(head.as_bytes());
            let _ = s.write_all(&a.bytes);
        }
        None => {
            let _ = s.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
        }
    }
}

fn run_web(app: AppHandle) {
    let listener = match TcpListener::bind("127.0.0.1:0") {
        Ok(l) => l,
        Err(_) => return app.exit(1),
    };
    let port = listener.local_addr().map(|a| a.port()).unwrap_or(0);
    let _ = listener.set_nonblocking(true);
    let _ = std::process::Command::new("cmd").args(["/C", "start", "", &format!("http://127.0.0.1:{port}/")]).spawn();
    std::thread::spawn(move || {
        let started = Instant::now();
        let mut pinged: Option<Instant> = None;
        loop {
            match listener.accept() {
                Ok((s, _)) => {
                    let _ = s.set_nonblocking(false);
                    serve_one(&app, s, &mut pinged);
                }
                Err(_) => std::thread::sleep(Duration::from_millis(100)),
            }
            // Quit once the pings stop; give a browser that never loads the page a minute before giving up.
            let quiet = match pinged {
                Some(t) => t.elapsed() > PING_TIMEOUT,
                None => started.elapsed() > Duration::from_secs(60),
            };
            if quiet {
                app.exit(0);
                return;
            }
        }
    });
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .setup(|app| {
            let show = |app: &AppHandle| {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                }
            };
            let args: Vec<String> = std::env::args().collect();
            let handle = app.handle().clone();
            if cfg!(debug_assertions) || args.iter().any(|a| a == "--desktop") {
                show(&handle);
            } else if args.iter().any(|a| a == "--web") {
                run_web(handle);
            } else {
                app.dialog()
                    .message("Run Sound System Designer as a desktop app, or open it in your web browser?")
                    .title("Sound System Designer")
                    .buttons(MessageDialogButtons::YesNoCancelCustom("Desktop app".into(), "Web app".into(), "Cancel".into()))
                    .show_with_result(move |r| match r {
                        tauri_plugin_dialog::MessageDialogResult::Custom(s) if s == "Desktop app" => show(&handle),
                        tauri_plugin_dialog::MessageDialogResult::Custom(s) if s == "Web app" => run_web(handle),
                        _ => handle.exit(0),
                    });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Sound System Designer");
}
