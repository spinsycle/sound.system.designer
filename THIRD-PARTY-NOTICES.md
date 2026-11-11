# Third-party notices

Sound System Designer is licensed under the GNU Affero General Public License, version 3 only (see `LICENSE`). It
includes or builds on these components, each under its own licence. This list covers what ships in the installer;
development tools (TypeScript, Vitest, Vite and their plugins) are not part of it.

## JavaScript (bundled into the app)

| Package | Version | Licence |
|---|---|---|
| react | 19.3.1 | MIT |
| react-dom | 19.3.1 | MIT |
| three | 0.170.0 | MIT |
| @tauri-apps/api | 2.12.4 | Apache-2.0 OR MIT |
| @tauri-apps/plugin-dialog | 2.8.4 | MIT OR Apache-2.0 |
| @tauri-apps/plugin-fs | 2.7.1 | MIT OR Apache-2.0 |
| @tauri-apps/plugin-http | 2.8.3 | MIT OR Apache-2.0 |

## Rust (compiled into the desktop shell)

The Tauri framework and its plugins (`tauri`, `tauri-plugin-dialog`, `tauri-plugin-fs`, `tauri-plugin-http`) and their
dependencies are licensed under Apache-2.0 or MIT, or under permissive licences of similar terms. The exact set and
versions are in `src-tauri/Cargo.lock`.

## Runtime

The desktop app uses the Microsoft WebView2 runtime that ships with Windows 11 (not redistributed here). The Brief panel
talks to an Ollama server you run yourself; no model or Ollama code is included.

## Notices

MIT and Apache-2.0 require the licence text and copyright notices to accompany copies of the components. The full texts
are in each package's `LICENSE` file under `node_modules/` and in the crates' sources fetched by Cargo.
