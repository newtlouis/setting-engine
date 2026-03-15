use std::net::TcpStream;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use tauri::{Manager, RunEvent, Url};

struct ServerChild(Mutex<Option<Child>>);

const PROJECT_DIR: &str = "/Users/louis/Projects/private/setting-engine";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(ServerChild(Mutex::new(None)))
        .setup(|app| {
            // Only spawn server if port 3000 is not already in use
            let server_already_running = TcpStream::connect("127.0.0.1:3000").is_ok();

            if !server_already_running {
                let child = Command::new("node")
                    .arg("agents/dashboard/server.js")
                    .current_dir(PROJECT_DIR)
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .spawn()
                    .expect("Failed to start Express server — is Node.js installed?");

                let state = app.state::<ServerChild>();
                *state.0.lock().unwrap() = Some(child);
            }

            // Navigate to Express server once it's ready
            let window = app.get_webview_window("main").unwrap();
            thread::spawn(move || {
                for _ in 0..30 {
                    if TcpStream::connect("127.0.0.1:3000").is_ok() {
                        let url = Url::parse("http://localhost:3000").unwrap();
                        let _ = window.navigate(url);
                        return;
                    }
                    thread::sleep(Duration::from_millis(500));
                }
                eprintln!("Express server failed to start within 15 seconds");
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let RunEvent::Exit = event {
            // Kill the Express server when the app closes
            let child = app_handle.state::<ServerChild>().0.lock().unwrap().take();
            if let Some(mut c) = child {
                let _ = c.kill();
            }
        }
    });
}
