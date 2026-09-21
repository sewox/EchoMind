use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::Duration;
use sysinfo::System;
use tauri::{AppHandle, Emitter, Manager};

/// Escapes a value for safe interpolation inside a double-quoted AppleScript string literal.
/// All current callers pass hardcoded app names, but this closes the injection path
/// (e.g. `do shell script` via an unescaped quote/backslash) for any future caller that doesn't.
#[cfg(target_os = "macos")]
fn escape_applescript_string(input: &str) -> String {
    input.replace('\\', "\\\\").replace('"', "\\\"")
}

/// Runs `osascript -e <script>` with a hard wall-clock timeout. Every call site in
/// the detection hot path (scan_processes' browser tab scan, is_app_in_active_call's
/// per-app checks) used to call `Command::output()` directly, which blocks with no
/// timeout at all — a single slow AppleScript call (a browser with many open tabs,
/// a busy system, an unresponsive app) could stall the entire 1s polling loop
/// indefinitely, silently blowing past the "island exits Aktif within 5s of the
/// meeting ending" bound the loop is designed to meet, since the loop can't even
/// reach its next iteration until the current one returns. Returns the trimmed
/// stdout on success, None on timeout/spawn/exit failure — callers already treat a
/// failed osascript call as "unknown" via their existing `.unwrap_or(...)` fallback.
#[cfg(target_os = "macos")]
fn run_osascript_with_timeout(script: &str, timeout: Duration) -> Option<String> {
    let mut child = std::process::Command::new("osascript")
        .args(["-e", script])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .ok()?;

    let start = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() {
                    return None;
                }
                use std::io::Read;
                let mut stdout = String::new();
                if let Some(mut out) = child.stdout.take() {
                    let _ = out.read_to_string(&mut stdout);
                }
                return Some(stdout);
            }
            Ok(None) => {
                if start.elapsed() >= timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    return None;
                }
                thread::sleep(Duration::from_millis(50));
            }
            Err(_) => return None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MeetingAppInfo {
    pub app_id: String,
    pub display_name: String,
    pub process_name: String,
    pub is_running: bool,
    pub recommended_title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectorSettings {
    pub enabled: bool,
    pub auto_start_record: bool,
    pub auto_stop_on_app_close: bool,
    pub ignored_apps: Vec<String>,
}

impl Default for DetectorSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            auto_start_record: false,
            auto_stop_on_app_close: true,
            ignored_apps: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectorStatus {
    pub is_active: bool,
    pub detected_apps: Vec<MeetingAppInfo>,
    pub active_count: usize,
    pub last_check_timestamp: String,
    pub settings: DetectorSettings,
}

static DISMISSED_SESSION_ID: OnceLock<Mutex<Option<String>>> = OnceLock::new();

fn get_dismissed_session() -> &'static Mutex<Option<String>> {
    DISMISSED_SESSION_ID.get_or_init(|| Mutex::new(None))
}

/// Scans AppleScript tab-title/URL output for the first *valid* Google Meet
/// room code among every `meet.google.com/` occurrence — not just the first
/// one. Real bug, reproduced live (Grok Bot's v0.2.10 re-test): when a
/// leftover `/home` (or `/landing`/`/new`) tab from a previously-ended
/// meeting stays open, and that leftover tab happens to be the *first*
/// `meet.google.com/` occurrence in the multi-tab AppleScript dump, the old
/// code took only that first match, saw it was home/invalid, and gave up —
/// even though a second, genuinely active room URL was present later in the
/// very same output. That made a brand-new meeting undetectable (no island,
/// no "meeting-detected", and — since the same signal feeds end-detection —
/// no prompt auto-stop either) for as long as the stale home tab stayed
/// open. A directly-observed active room URL is stronger, more current
/// evidence than a phrase possibly left over in some other tab's title, so
/// this supersedes the old whole-output phrase-based leave check.
fn extract_active_meet_code(raw_stdout: &str) -> Option<String> {
    for chunk in raw_stdout.split([',', ' ', '\n']) {
        if !chunk.contains("meet.google.com/") {
            continue;
        }
        let code = chunk
            .split("meet.google.com/")
            .nth(1)
            .map(|c| c.split('?').next().unwrap_or(c))
            .map(|c| c.trim_matches(|ch: char| !ch.is_alphanumeric() && ch != '-'))
            .unwrap_or("");

        let is_invalid = code.is_empty()
            || code == "landing"
            || code == "home"
            || code == "new"
            || code.starts_with("_meet");
        let looks_like_room = code.contains('-') || code.len() >= 9;

        if !is_invalid && looks_like_room {
            return Some(code.to_string());
        }
    }
    None
}

/// Whether a freshly detected meeting should pop up the floating island prompt.
/// Never while a recording is already running — there's nothing to prompt for,
/// and it would just overlay/block the main window (matching the existing
/// hide-while-recording behavior in the polling loop).
fn should_show_island_on_detection(is_recording_now: bool) -> bool {
    !is_recording_now
}

pub struct MeetingDetector {
    pub is_running: Arc<Mutex<bool>>,
    pub detected_apps: Arc<Mutex<Vec<MeetingAppInfo>>>,
    pub settings: Arc<Mutex<DetectorSettings>>,
}

impl Default for MeetingDetector {
    fn default() -> Self {
        Self::new()
    }
}

impl MeetingDetector {
    pub fn new() -> Self {
        Self {
            is_running: Arc::new(Mutex::new(false)),
            detected_apps: Arc::new(Mutex::new(Vec::new())),
            settings: Arc::new(Mutex::new(DetectorSettings::default())),
        }
    }

    pub fn scan_processes() -> Vec<MeetingAppInfo> {
        let mut sys = System::new_all();
        sys.refresh_processes(sysinfo::ProcessesToUpdate::All);

        let targets: Vec<(&str, &str, Vec<&str>)> = vec![
            (
                "zoom",
                "Zoom",
                vec!["zoom.us", "zoom.exe", "zoom", "cpthost.exe", "cpthost"],
            ),
            (
                "teams",
                "Microsoft Teams",
                vec![
                    "teams.exe",
                    "teams",
                    "ms-teams.exe",
                    "ms-teams",
                    "msteams.exe",
                    "msteams",
                    "teams2",
                    "teams-for-linux",
                ],
            ),
            (
                "webex",
                "Cisco Webex",
                vec![
                    "webex.exe",
                    "webex",
                    "ciscocollabhost.exe",
                    "ciscocollabhost",
                    "atmgr.exe",
                    "webexmta",
                ],
            ),
            ("slack", "Slack", vec!["slack.exe", "slack"]),
            (
                "discord",
                "Discord",
                vec!["discord.exe", "discord", "discord-canary", "discord-ptb"],
            ),
            (
                "skype",
                "Skype",
                vec!["skype.exe", "skype", "skypeforlinux"],
            ),
            ("facetime", "Apple FaceTime", vec!["facetime"]),
        ];

        let mut results = Vec::new();
        let date_str = chrono::Local::now().format("%d %B %Y").to_string();

        // 1. Scan Standalone Native Desktop Apps (Cross-platform: macOS, Linux, Windows)
        for (app_id, display_name, match_patterns) in targets {
            let mut found = false;
            let mut matched_proc_name = String::new();

            for process in sys.processes().values() {
                let proc_name = process.name().to_string_lossy().to_lowercase();
                let base_name = proc_name.strip_suffix(".exe").unwrap_or(&proc_name);

                // Exclude system background daemons, message stores, helpers, updaters
                if proc_name.contains("helper")
                    || proc_name.contains("stored")
                    || proc_name.contains("daemon")
                    || proc_name.contains("update")
                    || proc_name.contains("service")
                    || proc_name.contains("crash")
                    || proc_name.contains("notification")
                    || proc_name.contains("renderer")
                    || proc_name.contains("gpu-process")
                {
                    continue;
                }

                for pattern in &match_patterns {
                    let pattern_base = pattern.strip_suffix(".exe").unwrap_or(*pattern);
                    if proc_name == *pattern || base_name == pattern_base {
                        // Check if the application is in an active call/meeting (not just text chatting)
                        if !Self::is_app_in_active_call(app_id) {
                            continue;
                        }

                        found = true;
                        matched_proc_name = proc_name.clone();
                        break;
                    }
                }
                if found {
                    break;
                }
            }

            if found {
                results.push(MeetingAppInfo {
                    app_id: app_id.to_string(),
                    display_name: display_name.to_string(),
                    process_name: matched_proc_name,
                    is_running: true,
                    recommended_title: format!("{} Toplantısı - {}", display_name, date_str),
                });
            }
        }

        // 2. Scan Browser-based Meetings (Google Meet, Teams Web, Zoom Web) via AppleScript on macOS
        #[cfg(target_os = "macos")]
        {
            let browser_candidates = vec![
                ("Google Chrome", vec!["chrome", "google chrome"]),
                ("Arc", vec!["arc"]),
                ("Brave Browser", vec!["brave", "brave browser"]),
                ("Microsoft Edge", vec!["edge", "microsoft edge", "msedge"]),
                ("Safari", vec!["safari"]),
            ];

            // Only query browsers that are actually running to avoid heavy osascript spawn overhead
            let running_browsers: Vec<&str> = browser_candidates
                .into_iter()
                .filter(|(_browser_name, match_names)| {
                    sys.processes().values().any(|p| {
                        let pname = p.name().to_string_lossy().to_lowercase();
                        match_names
                            .iter()
                            .any(|m| pname == *m || pname.starts_with(m))
                    })
                })
                .map(|(b, _)| b)
                .collect();

            for browser in running_browsers {
                let safe_browser = escape_applescript_string(browser);
                let script = if browser == "Safari" {
                    format!(
                        "tell application \"{}\" to if running then get {{name, URL}} of tabs of every window",
                        safe_browser
                    )
                } else {
                    format!(
                        "tell application \"{}\" to if running then get {{title, URL}} of tabs of every window & name of every window",
                        safe_browser
                    )
                };

                if let Ok(output) = std::process::Command::new("osascript")
                    .args(["-e", &script])
                    .output()
                {
                    if output.status.success() {
                        let raw_stdout = String::from_utf8_lossy(&output.stdout);
                        let titles_str = raw_stdout.to_lowercase();

                        // Google Meet Detection (Active In-Call Verification)
                        if titles_str.contains("meet.google.com")
                            || titles_str.contains("meet –")
                            || titles_str.contains("meet -")
                            || titles_str.contains("google meet")
                        {
                            if let Some(meeting_code) = extract_active_meet_code(&raw_stdout) {
                                if !results.iter().any(|r| r.app_id == "meet") {
                                    let proc_name =
                                        format!("{} (Google Meet - {})", browser, meeting_code);
                                    let rec_title = format!(
                                        "Google Meet Toplantısı ({}) - {}",
                                        meeting_code, date_str
                                    );

                                    results.push(MeetingAppInfo {
                                        app_id: "meet".to_string(),
                                        display_name: "Google Meet".to_string(),
                                        process_name: proc_name,
                                        is_running: true,
                                        recommended_title: rec_title,
                                    });
                                }
                            }
                        }

                        // Web-based Microsoft Teams Detection (URL or Tab title)
                        if (titles_str.contains("teams.microsoft.com")
                            || titles_str.contains("teams.live.com")
                            || titles_str.contains("teams |")
                            || (titles_str.contains("teams") && titles_str.contains("meeting"))
                            || (titles_str.contains("teams") && titles_str.contains("toplantı")))
                            && !results.iter().any(|r| r.app_id == "teams")
                        {
                            results.push(MeetingAppInfo {
                                app_id: "teams".to_string(),
                                display_name: "Microsoft Teams (Web)".to_string(),
                                process_name: format!("{} (Teams)", browser),
                                is_running: true,
                                recommended_title: format!(
                                    "Microsoft Teams Toplantısı - {}",
                                    date_str
                                ),
                            });
                        }
                    }
                }
            }
        }

        results
    }

    pub fn is_app_in_active_call(_app_id: &str) -> bool {
        #[cfg(target_os = "macos")]
        {
            match _app_id {
                "facetime" => run_osascript_with_timeout(
                    "tell application \"System Events\" to return (exists (processes where name is \"FaceTime\"))",
                    Duration::from_millis(1500),
                )
                .map(|s| {
                    let s = s.trim().to_lowercase();
                    s == "true" || s.is_empty()
                })
                .unwrap_or(true),
                "teams" => {
                    let script = "tell application \"System Events\"
                        if exists (processes where name contains \"Teams\") then
                            tell (first process whose name contains \"Teams\")
                                set winTitles to name of every window
                                repeat with t in winTitles
                                    set tLow to (t as text)
                                    if tLow contains \"Meeting\" or tLow contains \"Toplantı\" or tLow contains \"Call\" or tLow contains \"Görüşme\" or tLow contains \"Arama\" then
                                        return \"true\"
                                    end if
                                end repeat
                            end tell
                        end if
                        return \"true\"
                    end tell";
                    run_osascript_with_timeout(script, Duration::from_millis(1500))
                        .map(|s| s.trim().to_lowercase() != "false")
                        .unwrap_or(true)
                }
                "slack" => {
                    let script = "tell application \"System Events\"
                        if exists (processes where name is \"Slack\") then
                            tell process \"Slack\"
                                set winTitles to name of every window
                                repeat with t in winTitles
                                    set tLow to (t as text)
                                    if tLow contains \"Huddle\" or tLow contains \"Call\" or tLow contains \"Sesli\" or tLow contains \"Görüşme\" then
                                        return \"true\"
                                    end if
                                end repeat
                            end tell
                        end if
                        return \"true\"
                    end tell";
                    run_osascript_with_timeout(script, Duration::from_millis(1500))
                        .map(|s| s.trim().to_lowercase() != "false")
                        .unwrap_or(true)
                }
                "zoom" => {
                    let mut sys = System::new();
                    sys.refresh_processes(sysinfo::ProcessesToUpdate::All);
                    let has_cpthost = sys.processes().values().any(|p| {
                        let n = p.name().to_string_lossy().to_lowercase();
                        n.contains("cpthost") || n.contains("zoom")
                    });
                    if has_cpthost {
                        return true;
                    }
                    let script = "tell application \"System Events\"
                        if exists (processes where name contains \"zoom\") then
                            tell (first process whose name contains \"zoom\")
                                set winTitles to name of every window
                                repeat with t in winTitles
                                    set tLow to (t as text)
                                    if tLow contains \"Meeting\" or tLow contains \"Toplantı\" then
                                        return \"true\"
                                    end if
                                end repeat
                            end tell
                        end if
                        return \"true\"
                    end tell";
                    run_osascript_with_timeout(script, Duration::from_millis(1500))
                        .map(|s| s.trim().to_lowercase() != "false")
                        .unwrap_or(true)
                }
                "discord" => {
                    let script = "tell application \"System Events\"
                        if exists (processes where name is \"Discord\") then
                            tell process \"Discord\"
                                set winTitles to name of every window
                                repeat with t in winTitles
                                    set tLow to (t as text)
                                    if tLow contains \"Voice\" or tLow contains \"Ses\" or tLow contains \"Call\" or tLow contains \"Görüşme\" then
                                        return \"true\"
                                    end if
                                end repeat
                            end tell
                        end if
                        return \"true\"
                    end tell";
                    run_osascript_with_timeout(script, Duration::from_millis(1500))
                        .map(|s| s.trim().to_lowercase() != "false")
                        .unwrap_or(true)
                }
                _ => true,
            }
        }
        #[cfg(not(target_os = "macos"))]
        {
            true
        }
    }

    pub fn get_target_meeting_window_bounds() -> Option<(f64, f64, f64, f64)> {
        #[cfg(target_os = "macos")]
        {
            let browser_apps = vec![
                "Google Chrome",
                "Arc",
                "Brave Browser",
                "Microsoft Edge",
                "Safari",
            ];

            for browser in browser_apps {
                let script = format!(
                    "tell application \"{}\"
                        if running then
                            repeat with w in windows
                                set wBounds to bounds of w
                                repeat with t in tabs of w
                                    if (URL of t contains \"meet.google.com\") or (title of t contains \"Meet\") or (title of w contains \"Meet\") then
                                        return wBounds
                                    end if
                                end repeat
                            end repeat
                        end if
                    end tell",
                    browser
                );

                if let Ok(output) = std::process::Command::new("osascript")
                    .args(["-e", &script])
                    .output()
                {
                    if output.status.success() {
                        let out_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
                        let parts: Vec<&str> = out_str.split(',').map(|s| s.trim()).collect();
                        if parts.len() == 4 {
                            if let (Ok(left), Ok(top), Ok(right), Ok(bottom)) = (
                                parts[0].parse::<f64>(),
                                parts[1].parse::<f64>(),
                                parts[2].parse::<f64>(),
                                parts[3].parse::<f64>(),
                            ) {
                                let width = (right - left).max(200.0);
                                let height = (bottom - top).max(200.0);
                                return Some((left, top, width, height));
                            }
                        }
                    }
                }
            }
        }
        None
    }

    pub fn start_monitoring(&self, app_handle: Option<AppHandle>) -> Result<(), String> {
        let mut running = self.is_running.lock().unwrap();
        if *running {
            return Ok(());
        }
        *running = true;
        drop(running);

        let is_running_clone = self.is_running.clone();
        let detected_apps_clone = self.detected_apps.clone();
        let settings_clone = self.settings.clone();

        thread::spawn(move || {
            println!("🔍 Toplantı ve Ses Algılama Servisi Başlatıldı (1.0s Hızlı Tepki).");
            let mut last_detected_id = String::new();
            let mut consecutive_misses: u32 = 0;
            let mut previous_apps: Vec<MeetingAppInfo> = Vec::new();

            while *is_running_clone.lock().unwrap() {
                let current_settings = {
                    let s = settings_clone.lock().unwrap();
                    s.clone()
                };

                if !current_settings.enabled {
                    thread::sleep(Duration::from_millis(1000));
                    continue;
                }

                let all_active = Self::scan_processes();
                let filtered_active: Vec<MeetingAppInfo> = all_active
                    .into_iter()
                    .filter(|app| !current_settings.ignored_apps.contains(&app.app_id))
                    .collect();

                let current_count = filtered_active.len();

                {
                    let mut lock = detected_apps_clone.lock().unwrap();
                    *lock = filtered_active.clone();
                }

                if current_count > 0 {
                    consecutive_misses = 0;
                    let current_primary = &filtered_active[0];
                    let current_id = format!(
                        "{}-{}",
                        current_primary.app_id, current_primary.process_name
                    );

                    let is_dismissed = {
                        let dismissed = get_dismissed_session().lock().unwrap();
                        dismissed
                            .as_ref()
                            .map(|d| d == &current_id)
                            .unwrap_or(false)
                    };

                    // Check if new meeting session or title changed
                    let mut should_trigger = false;
                    if current_id != last_detected_id {
                        should_trigger = true;
                        last_detected_id = current_id.clone();
                    }

                    let is_recording_now = crate::audio::get_global_audio_engine()
                        .get_status()
                        .is_recording;

                    if let Some(ref handle) = app_handle {
                        // Keep island hidden by default to avoid overlaying and blocking main window clicks
                        if let Some(island_win) = handle.get_webview_window("island") {
                            let is_visible = island_win.is_visible().unwrap_or(false);
                            if is_recording_now && is_visible {
                                let island_clone = island_win.clone();
                                let _ = handle.run_on_main_thread(move || {
                                    let _ = island_clone.hide();
                                });
                            }
                        }

                        if should_trigger && !is_dismissed {
                            println!(
                                "🚀 Toplantı Tespit Edildi: {} ({})",
                                current_primary.display_name, current_primary.process_name
                            );
                            let _ = handle.emit("meeting-detected", &filtered_active);

                            // Actually show the floating island prompt. This call
                            // was missing entirely: show_island_window existed
                            // only as a frontend-invokable command that nothing
                            // in the app ever called — the "meeting-detected"
                            // event alone only updated React state, it never
                            // made the island window visible. Confirmed live by
                            // Grok Bot's v0.2.9 re-test: joining a real Google
                            // Meet call never produced a second (island) window
                            // at all. Skip it if a recording is already running,
                            // matching the existing hide-while-recording logic
                            // just above — there's nothing to prompt for then.
                            if should_show_island_on_detection(is_recording_now) {
                                let _ = show_island_window(handle.clone());
                            }

                            #[cfg(target_os = "macos")]
                            {
                                let app_name =
                                    escape_applescript_string(&current_primary.display_name);
                                let notif_script = format!(
                                    "display notification \"{} toplantısı başladı. Kaydı başlatmak için tıklayın.\" with title \"EchoMind Asistan\" subtitle \"Toplantı Başladı\" sound name \"Glass\"",
                                    app_name
                                );
                                let _ = std::process::Command::new("osascript")
                                    .args(["-e", &notif_script])
                                    .spawn();
                            }
                        }
                    }

                    previous_apps = filtered_active;
                } else {
                    consecutive_misses += 1;
                    // End meeting immediately on 1 missed cycle (1-2 seconds response, well under 5s requirement)
                    if consecutive_misses >= 1 && !last_detected_id.is_empty() {
                        last_detected_id.clear();
                        {
                            let mut dismissed = get_dismissed_session().lock().unwrap();
                            *dismissed = None;
                        }
                        if current_settings.auto_stop_on_app_close {
                            let engine = crate::audio::get_global_audio_engine();
                            if engine.get_status().is_recording {
                                println!("🛑 Otomatik Kayıt Durdurma Sinyali (Toplantı Kapandı).");
                                let _ = engine.stop();
                                if let Some(ref handle) = app_handle {
                                    let _ = handle.emit("trigger-stop-recording", ());
                                }
                            }
                        }
                        if let Some(ref handle) = app_handle {
                            let _ = handle.emit("meeting-ended", &previous_apps);
                            if let Some(island_win) = handle.get_webview_window("island") {
                                let island_clone = island_win.clone();
                                let _ = handle.run_on_main_thread(move || {
                                    let _ = island_clone.hide();
                                });
                            }
                        }
                        println!(
                            "🛑 Toplantı Sona Erdi (< 3s doğrulandı), bitiş sinyali iletildi."
                        );
                    }
                }

                thread::sleep(Duration::from_millis(1000));
            }

            println!("🛑 Toplantı Algılama Servisi Durduruldu.");
        });

        Ok(())
    }

    pub fn stop_monitoring(&self) {
        let mut running = self.is_running.lock().unwrap();
        *running = false;
    }

    pub fn get_status(&self) -> DetectorStatus {
        let is_active = *self.is_running.lock().unwrap();
        let detected_apps = self.detected_apps.lock().unwrap().clone();
        let settings = self.settings.lock().unwrap().clone();
        let active_count = detected_apps.len();
        let last_check_timestamp = chrono::Local::now().format("%H:%M:%S").to_string();

        DetectorStatus {
            is_active,
            detected_apps,
            active_count,
            last_check_timestamp,
            settings,
        }
    }

    pub fn update_settings(&self, new_settings: DetectorSettings) -> DetectorStatus {
        {
            let mut s = self.settings.lock().unwrap();
            *s = new_settings;
        }
        self.get_status()
    }
}

pub fn get_global_detector() -> &'static MeetingDetector {
    static DETECTOR: OnceLock<MeetingDetector> = OnceLock::new();
    DETECTOR.get_or_init(MeetingDetector::new)
}

#[tauri::command]
pub fn start_meeting_detector(app_handle: AppHandle) -> Result<DetectorStatus, String> {
    let detector = get_global_detector();
    detector.start_monitoring(Some(app_handle))?;
    Ok(detector.get_status())
}

#[tauri::command]
pub fn stop_meeting_detector() -> DetectorStatus {
    let detector = get_global_detector();
    detector.stop_monitoring();
    detector.get_status()
}

#[tauri::command]
pub fn get_detector_status() -> DetectorStatus {
    let detector = get_global_detector();
    detector.get_status()
}

#[tauri::command]
pub fn update_detector_settings(settings: DetectorSettings) -> DetectorStatus {
    let detector = get_global_detector();
    detector.update_settings(settings)
}

#[tauri::command]
pub fn check_active_meetings() -> Vec<MeetingAppInfo> {
    MeetingDetector::scan_processes()
}

#[tauri::command]
pub fn show_island_window(app_handle: AppHandle) -> Result<(), String> {
    if let Some(island_win) = app_handle.get_webview_window("island") {
        let bounds_opt = MeetingDetector::get_target_meeting_window_bounds();
        let island_clone = island_win.clone();
        let _ = app_handle.run_on_main_thread(move || {
            if let Some((left, top, win_w, _win_h)) = bounds_opt {
                let target_x = left + (win_w - 560.0) / 2.0;
                let target_y = top + 15.0;
                let _ =
                    island_clone.set_position(tauri::Position::Logical(tauri::LogicalPosition {
                        x: target_x,
                        y: target_y,
                    }));
            } else if let Ok(Some(monitor)) = island_clone.current_monitor() {
                let scale = monitor.scale_factor();
                let mon_x = monitor.position().x as f64 / scale;
                let mon_y = monitor.position().y as f64 / scale;
                let mon_w = monitor.size().width as f64 / scale;
                let target_x = mon_x + (mon_w - 560.0) / 2.0;
                let target_y = mon_y + 15.0;
                let _ =
                    island_clone.set_position(tauri::Position::Logical(tauri::LogicalPosition {
                        x: target_x,
                        y: target_y,
                    }));
            }
            let _ = island_clone.show();
            let _ = island_clone.set_always_on_top(true);
        });
    }
    Ok(())
}

#[tauri::command]
pub fn hide_island_window(app_handle: AppHandle) -> Result<(), String> {
    if let Some(island_win) = app_handle.get_webview_window("island") {
        let _ = island_win.hide();
    }
    let detected = get_global_detector().detected_apps.lock().unwrap();
    if let Some(primary) = detected.first() {
        let current_id = format!("{}-{}", primary.app_id, primary.process_name);
        let mut dismissed = get_dismissed_session().lock().unwrap();
        *dismissed = Some(current_id);
    }
    Ok(())
}

#[tauri::command]
pub fn show_main_window(app_handle: AppHandle) -> Result<(), String> {
    if let Some(main_win) = app_handle.get_webview_window("main") {
        let _ = main_win.unminimize();
        let _ = main_win.show();
        let _ = main_win.set_focus();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detector_scan_runs_without_panic() {
        let active = MeetingDetector::scan_processes();
        // Verify scanning runs cleanly and returns vector
        let _ = active.len();
    }

    #[test]
    fn test_detector_status_and_settings() {
        let detector = MeetingDetector::new();
        let status = detector.get_status();
        assert!(!status.is_active);
        assert_eq!(status.active_count, 0);
        assert!(status.settings.enabled);
        assert!(!status.settings.auto_start_record);
        assert!(status.settings.auto_stop_on_app_close);

        // Update settings
        let updated = detector.update_settings(DetectorSettings {
            enabled: true,
            auto_start_record: true,
            auto_stop_on_app_close: false,
            ignored_apps: vec!["discord".to_string()],
        });

        assert!(updated.settings.auto_start_record);
        assert!(!updated.settings.auto_stop_on_app_close);
        assert_eq!(updated.settings.ignored_apps, vec!["discord".to_string()]);
    }

    #[test]
    fn test_extract_active_meet_code_finds_valid_room_when_first() {
        let raw = "Google Meet, https://meet.google.com/dhx-khct-ude, EchoMind AI Assistant";
        assert_eq!(
            extract_active_meet_code(raw),
            Some("dhx-khct-ude".to_string())
        );
    }

    #[test]
    fn test_extract_active_meet_code_returns_none_when_only_home() {
        let raw = "Google Meet, https://meet.google.com/home, EchoMind AI Assistant";
        assert_eq!(extract_active_meet_code(raw), None);
    }

    #[test]
    fn test_extract_active_meet_code_skips_leading_home_finds_later_valid_room() {
        // Exact shape of Grok Bot's v0.2.10 live repro (sticky_repro_r2.txt): a
        // leftover /home tab from a previously-ended meeting is still open,
        // and a genuinely active second meeting's room URL appears later in
        // the same multi-tab AppleScript dump. The old code took only the
        // first meet.google.com/ match (the stale /home one) and gave up.
        let raw = "Google Meet, https://meet.google.com/home, \
                    Meet - dhx-khct-ude, https://meet.google.com/dhx-khct-ude, \
                    EchoMind AI Assistant";
        assert_eq!(
            extract_active_meet_code(raw),
            Some("dhx-khct-ude".to_string())
        );
    }

    #[test]
    fn test_extract_active_meet_code_skips_landing_and_new() {
        let raw = "Meet, https://meet.google.com/landing, \
                    Meet, https://meet.google.com/new, \
                    Meet - sgi-qgxg-gvx, https://meet.google.com/sgi-qgxg-gvx";
        assert_eq!(
            extract_active_meet_code(raw),
            Some("sgi-qgxg-gvx".to_string())
        );
    }

    #[test]
    fn test_extract_active_meet_code_none_when_no_meet_url_present() {
        assert_eq!(extract_active_meet_code("New Tab, Google Chrome"), None);
    }

    #[test]
    fn test_should_show_island_on_detection() {
        // Regression guard: show_island_window() used to be wired up nowhere at
        // all, so the island never appeared for a real meeting (Grok Bot's
        // v0.2.9 live re-test). This locks in the intended gating now that the
        // call site actually exists.
        assert!(should_show_island_on_detection(false));
        assert!(!should_show_island_on_detection(true));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn test_run_osascript_with_timeout_returns_output_on_success() {
        let out = run_osascript_with_timeout("return \"hello\"", Duration::from_secs(5));
        assert_eq!(out.as_deref(), Some("hello\n"));
    }

    // Proves the "island exits Aktif within 5s" bound actually holds even if a
    // single AppleScript call hangs (e.g. a browser with many tabs, a busy
    // system): a deliberately slow script must be killed at the timeout, not
    // silently block the caller for its own full duration.
    #[cfg(target_os = "macos")]
    #[test]
    fn test_run_osascript_with_timeout_kills_hung_script_within_bound() {
        let start = std::time::Instant::now();
        let out =
            run_osascript_with_timeout("delay 5\nreturn \"too late\"", Duration::from_millis(300));
        let elapsed = start.elapsed();

        assert!(out.is_none(), "a hung script must time out, not succeed");
        assert!(
            elapsed < Duration::from_secs(2),
            "timeout must be enforced promptly, took {:?}",
            elapsed
        );
    }
}
