//! Mic-activity based meeting detection — the one detection method on every
//! platform: a meeting is an app holding the microphone, and it ends when the
//! app lets go. An open meeting app that is not in a call is not a meeting.
//!
//! Which processes hold the microphone comes from the OS:
//! - macOS 14.2+: Core Audio process objects (Swift bridge `echomind_mic_proc_*`)
//! - Windows 10+: the privacy registry behind the taskbar "microphone in use"
//!   icon (`CapabilityAccessManager\ConsentStore\microphone`)
//! - Linux: PulseAudio / PipeWire recording streams (`libpulse`, loaded at
//!   run time)
//!
//! This module also owns the debounce / session state machine (~5 s hold,
//! short drop grace), the default + user ignore lists, browser helper →
//! parent app resolution and display-name hints (hints only, never a gate).
//! Where the OS can't say (macOS before 14.2, Linux without libpulse),
//! nothing is detected and recording stays manual.

use serde::Deserialize;
use std::collections::HashMap;
use std::time::Duration;

/// Continuous mic-hold required before a process is treated as a meeting.
pub const MIC_HOLD_THRESHOLD: Duration = Duration::from_secs(5);
/// How long after mic drop we still treat the session as active (debounce).
pub const MIC_DROP_GRACE: Duration = Duration::from_secs(2);

/// EchoMind's own bundle id — never reported as a meeting.
pub const ECHOMIND_BUNDLE_ID: &str = "com.echomind.assistant";

/// Default ignore list: dictation / voice-memo / non-meeting recorders.
/// Users can add or remove entries via detector settings (`ignored_apps`).
pub fn default_ignored_bundle_ids() -> Vec<String> {
    DEFAULT_IGNORED_BUNDLE_IDS
        .iter()
        .map(|s| (*s).to_string())
        .collect()
}

const DEFAULT_IGNORED_BUNDLE_IDS: &[&str] = &[
    "com.apple.VoiceMemos",
    "com.apple.assistant_service",
    "com.apple.Siri",
    "com.apple.siri.context.service",
    "com.apple.SpeechRecognitionCore.brokerd",
    "com.apple.SpeechRecognitionCore.speechrecognitiond",
    "com.apple.inputmethod.ChineseTraditional.Shuangpin",
    "com.apple.inputmethod.SCIM",
    "com.apple.DictationIM",
    "com.apple.ControlCenter",
    "com.apple.audio.AudioComponentRegistrar",
    "com.apple.QuickTimePlayerX",
    "com.apple.garageband10",
    "com.apple.logic10",
    "com.apple.music",
    "com.apple.iMovieApp",
    "com.apple.ScreenContinuity",
    // Common third-party recorders / non-meeting capture tools
    "com.loom.desktop",
    "com.obsproject.obs-studio",
    "com.knollsoft.Rectangle",
    // Windows / Linux recorders (ids as `canonical_app_id` gives them)
    "Microsoft.WindowsSoundRecorder_8wekyb3d8bbwe",
    "audacity",
    "gnome-sound-recorder",
];

/// A process the OS reports as holding mic input.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct MicHoldingProcess {
    pub pid: i32,
    pub bundle_id: String,
    pub display_name: String,
}

/// Resolved identity after helper→parent mapping.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedMicApp {
    pub app_id: String,
    pub display_name: String,
    pub process_name: String,
    pub is_browser: bool,
    pub pid: i32,
}

/// Pure debounce / session tracker. Keyed by resolved `app_id` so helper and
/// parent of the same browser share one session.
#[derive(Debug, Default)]
pub struct MicHoldTracker {
    entries: HashMap<String, MicHoldEntry>,
}

#[derive(Debug, Clone)]
struct MicHoldEntry {
    /// Virtual-ms when continuous hold started (or resumed after grace expiry).
    hold_since_ms: u64,
    /// Virtual-ms of last observation while holding.
    last_seen_ms: u64,
    /// Already emitted as a "possible meeting" for this continuous session.
    reported: bool,
    /// Last known display / process metadata for building MeetingAppInfo.
    display_name: String,
    process_name: String,
    is_browser: bool,
    pid: i32,
}

/// Outcome of one tracker tick.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MicHoldSnapshot {
    /// Sessions that have held the mic continuously for >= threshold.
    pub active: Vec<ResolvedMicApp>,
    /// Sessions that just crossed the threshold this tick (new prompts).
    pub newly_reported: Vec<ResolvedMicApp>,
    /// Sessions that ended this tick (after drop grace).
    pub ended: Vec<String>,
}

impl MicHoldTracker {
    pub fn new() -> Self {
        Self::default()
    }

    /// Advance the state machine.
    ///
    /// `now_ms` is a monotonic clock in milliseconds (tests inject a fake clock;
    /// production uses `Instant`-based elapsed ms from process start).
    pub fn tick(&mut self, now_ms: u64, currently_holding: &[ResolvedMicApp]) -> MicHoldSnapshot {
        let holding_ids: std::collections::HashSet<&str> = currently_holding
            .iter()
            .map(|a| a.app_id.as_str())
            .collect();

        // Update / insert holders.
        for app in currently_holding {
            match self.entries.get_mut(&app.app_id) {
                Some(entry) => {
                    // Still holding (or returned within grace — see below):
                    // if we were in "soft drop" we keep hold_since; only refresh last_seen.
                    entry.last_seen_ms = now_ms;
                    entry.display_name = app.display_name.clone();
                    entry.process_name = app.process_name.clone();
                    entry.is_browser = app.is_browser;
                    entry.pid = app.pid;
                }
                None => {
                    self.entries.insert(
                        app.app_id.clone(),
                        MicHoldEntry {
                            hold_since_ms: now_ms,
                            last_seen_ms: now_ms,
                            reported: false,
                            display_name: app.display_name.clone(),
                            process_name: app.process_name.clone(),
                            is_browser: app.is_browser,
                            pid: app.pid,
                        },
                    );
                }
            }
        }

        let threshold_ms = MIC_HOLD_THRESHOLD.as_millis() as u64;
        let grace_ms = MIC_DROP_GRACE.as_millis() as u64;

        let mut newly_reported = Vec::new();
        let mut active = Vec::new();
        let mut ended = Vec::new();
        let mut to_remove = Vec::new();

        for (id, entry) in self.entries.iter_mut() {
            let is_holding_now = holding_ids.contains(id.as_str());
            if is_holding_now {
                let held_for = now_ms.saturating_sub(entry.hold_since_ms);
                if held_for >= threshold_ms {
                    let resolved = ResolvedMicApp {
                        app_id: id.clone(),
                        display_name: entry.display_name.clone(),
                        process_name: entry.process_name.clone(),
                        is_browser: entry.is_browser,
                        pid: entry.pid,
                    };
                    if !entry.reported {
                        entry.reported = true;
                        newly_reported.push(resolved.clone());
                    }
                    active.push(resolved);
                }
            } else {
                // Soft drop: keep the session until grace expires.
                let since_drop = now_ms.saturating_sub(entry.last_seen_ms);
                if since_drop > grace_ms {
                    if entry.reported {
                        ended.push(id.clone());
                    }
                    to_remove.push(id.clone());
                } else if entry.reported {
                    // Still within grace — surface as active so the island
                    // does not flicker on brief mic hiccups.
                    active.push(ResolvedMicApp {
                        app_id: id.clone(),
                        display_name: entry.display_name.clone(),
                        process_name: entry.process_name.clone(),
                        is_browser: entry.is_browser,
                        pid: entry.pid,
                    });
                }
            }
        }

        for id in to_remove {
            self.entries.remove(&id);
        }

        // If a session ended and the same app_id reappears later, it gets a
        // fresh entry (hold_since reset) — that is the "one prompt per session"
        // contract: re-prompt only after a full drop past grace.

        MicHoldSnapshot {
            active,
            newly_reported,
            ended,
        }
    }

    /// Reset a single session (e.g. after explicit dismiss + mic still held
    /// should not immediately re-fire — monitored via detector dismissed id).
    #[cfg(test)]
    pub fn clear(&mut self) {
        self.entries.clear();
    }
}

/// Map a raw Core Audio bundle id (often a browser *helper*) to the parent app.
pub fn resolve_helper_to_parent(bundle_id: &str) -> String {
    let b = bundle_id.trim();
    if b.is_empty() {
        return b.to_string();
    }

    // Chrome family helpers / renderers / GPU / alerter
    if b == "com.google.Chrome"
        || b.starts_with("com.google.Chrome.")
        || b.starts_with("com.google.chrome.")
    {
        return "com.google.Chrome".to_string();
    }
    if b == "com.brave.Browser" || b.starts_with("com.brave.Browser.") {
        return "com.brave.Browser".to_string();
    }
    if b == "company.thebrowser.Browser" || b.starts_with("company.thebrowser.Browser.") {
        return "company.thebrowser.Browser".to_string(); // Arc
    }
    if b == "com.microsoft.edgemac" || b.starts_with("com.microsoft.edgemac.") {
        return "com.microsoft.edgemac".to_string();
    }
    if b == "org.mozilla.firefox" || b.starts_with("org.mozilla.firefox.") {
        return "org.mozilla.firefox".to_string();
    }
    // Safari / WebKit: GPU and networking processes do the capturing.
    if b == "com.apple.Safari"
        || b.starts_with("com.apple.WebKit.")
        || b == "com.apple.Safari.WebApp"
    {
        return "com.apple.Safari".to_string();
    }

    b.to_string()
}

/// Maps a Windows executable / package name or a Linux binary name to the
/// app id used everywhere else (the macOS bundle id), so ignore lists,
/// display names and browser handling work the same on every platform.
/// Unknown names come back lowercased, without ".exe".
pub fn canonical_app_id(raw: &str) -> String {
    let lower = raw.trim().to_ascii_lowercase();
    let name = lower.strip_suffix(".exe").unwrap_or(&lower);
    if is_own_executable(name) {
        return ECHOMIND_BUNDLE_ID.to_string();
    }
    known_app_id(name).map_or_else(|| name.to_string(), str::to_string)
}

/// The app id of a well-known executable or binary name, if it is one.
fn known_app_id(raw: &str) -> Option<&'static str> {
    let lower = raw.trim().to_ascii_lowercase();
    let name = lower.strip_suffix(".exe").unwrap_or(&lower);
    let id = match name {
        "chrome" | "google-chrome" | "google-chrome-stable" | "chromium" | "chromium-browser" => {
            "com.google.Chrome"
        }
        "msedge" | "microsoft-edge" | "microsoft-edge-stable" => "com.microsoft.edgemac",
        "firefox" | "firefox-bin" | "firefox-esr" => "org.mozilla.firefox",
        "brave" | "brave-browser" => "com.brave.Browser",
        "zoom" | "cpthost" | "zoomwebviewhost" => "us.zoom.xos",
        "ms-teams" | "teams" | "msteams" | "teams-for-linux" => "com.microsoft.teams2",
        "discord" | "discordcanary" | "discordptb" => "com.hnc.Discord",
        "slack" => "com.tinyspeck.slackmacgap",
        "skype" | "skypeapp" | "skypeforlinux" => "com.skype.skype",
        "webex" | "ciscocollabhost" | "webexmta" | "atmgr" | "ciscowebexstart" => {
            "Cisco-Systems.Spark"
        }
        "obs" | "obs64" | "obs32" => "com.obsproject.obs-studio",
        _ => return None,
    };
    Some(id)
}

/// EchoMind's own executable ("echomind", or whatever this binary is called).
fn is_own_executable(name: &str) -> bool {
    if name == "echomind" {
        return true;
    }
    std::env::current_exe()
        .ok()
        .and_then(|p| {
            p.file_stem()
                .map(|s| s.to_string_lossy().to_ascii_lowercase())
        })
        .is_some_and(|own| own == name)
}

/// Whether the (resolved) bundle id is a browser we can enrich via tab titles.
pub fn is_browser_bundle_id(bundle_id: &str) -> bool {
    matches!(
        bundle_id,
        "com.google.Chrome"
            | "com.brave.Browser"
            | "company.thebrowser.Browser"
            | "com.microsoft.edgemac"
            | "org.mozilla.firefox"
            | "com.apple.Safari"
    )
}

/// Human-readable browser name for titles like "<Browser> Toplantısı".
pub fn browser_display_name(bundle_id: &str) -> Option<&'static str> {
    match bundle_id {
        "com.google.Chrome" => Some("Google Chrome"),
        "com.brave.Browser" => Some("Brave Browser"),
        "company.thebrowser.Browser" => Some("Arc"),
        "com.microsoft.edgemac" => Some("Microsoft Edge"),
        "org.mozilla.firefox" => Some("Firefox"),
        "com.apple.Safari" => Some("Safari"),
        _ => None,
    }
}

/// Known meeting-app hints: nicer display names only — never a detection gate.
pub fn known_app_display_name(bundle_id: &str) -> Option<&'static str> {
    match bundle_id {
        "us.zoom.xos" | "zoom.us.ZoomPresence" => Some("Zoom"),
        "com.microsoft.teams" | "com.microsoft.teams2" | "com.microsoft.teams2.helper" => {
            Some("Microsoft Teams")
        }
        "com.cisco.webexmeetingsapp" | "com.webex.meetingmanager" | "Cisco-Systems.Spark" => {
            Some("Cisco Webex")
        }
        "com.hnc.Discord" | "com.discord.Discord" => Some("Discord"),
        "com.tinyspeck.slackmacgap" => Some("Slack"),
        "com.skype.skype" => Some("Skype"),
        "com.apple.FaceTime" => Some("Apple FaceTime"),
        "com.zoho.meeting" | "com.zoho.ZohoMeeting" => Some("Zoho Meeting"),
        "us.zoom.ZoomPresence" => Some("Zoom"),
        "com.google.Chrome.app.kjgfgldnnfoeklglpeeioegobpeugdeg" => Some("Google Meet"), // PWA-ish
        _ => None,
    }
}

/// Prefer a localized/OS-provided name, then known-app hint, then raw name.
pub fn prefer_display_name(bundle_id: &str, os_name: &str) -> String {
    if let Some(hint) = known_app_display_name(bundle_id) {
        return hint.to_string();
    }
    if let Some(browser) = browser_display_name(bundle_id) {
        return browser.to_string();
    }
    let trimmed = os_name.trim();
    if !trimmed.is_empty() && !trimmed.starts_with("pid:") {
        // Strip common "Helper" suffixes for cleaner titles.
        let cleaned = trimmed
            .trim_end_matches(" Helper")
            .trim_end_matches(" (Renderer)")
            .trim_end_matches(" GPU");
        if !cleaned.is_empty() {
            return cleaned.to_string();
        }
    }
    bundle_id
        .split('.')
        .next_back()
        .filter(|s| !s.is_empty())
        .unwrap_or(bundle_id)
        .to_string()
}

/// Hard exclusions that are never user-configurable (EchoMind itself).
pub fn is_echomind_bundle(bundle_id: &str) -> bool {
    let b = bundle_id.trim();
    b == ECHOMIND_BUNDLE_ID || b.starts_with("com.echomind.")
}

/// Whether `bundle_id` / `app_id` should be ignored given the configured list
/// (defaults + user additions). Matches exact bundle id, parent after helper
/// resolution, known short aliases (`zoom`, `discord`, …), and EchoMind.
pub fn is_ignored_bundle(bundle_id: &str, ignored: &[String]) -> bool {
    if is_echomind_bundle(bundle_id) {
        return true;
    }
    let resolved = resolve_helper_to_parent(bundle_id);
    if is_echomind_bundle(&resolved) {
        return true;
    }

    for entry in ignored {
        let e = entry.trim();
        if e.is_empty() {
            continue;
        }
        if e == bundle_id || e == resolved {
            return true;
        }
        // Short aliases used by the legacy detector / older settings UI.
        if alias_matches(e, &resolved) {
            return true;
        }
    }
    // Built-in defaults always apply even if the user cleared settings —
    // unless the user explicitly removed them from the merged ignore list.
    // Callers pass `effective_ignore_list(settings.ignored_apps)`.
    false
}

fn alias_matches(alias: &str, bundle_id: &str) -> bool {
    let a = alias.to_ascii_lowercase();
    match a.as_str() {
        "zoom" => bundle_id == "us.zoom.xos" || bundle_id.starts_with("us.zoom."),
        "teams" => bundle_id.contains("teams") || bundle_id.contains("Teams"),
        "webex" => bundle_id.to_ascii_lowercase().contains("webex"),
        "discord" => bundle_id.to_ascii_lowercase().contains("discord"),
        "slack" => bundle_id.to_ascii_lowercase().contains("slack"),
        "skype" => bundle_id.to_ascii_lowercase().contains("skype"),
        "facetime" => bundle_id == "com.apple.FaceTime",
        "voicememos" | "voice-memos" => bundle_id == "com.apple.VoiceMemos",
        _ => false,
    }
}

/// Merge user ignore list with built-in defaults.
///
/// If the stored list is empty (fresh install / island "always auto-start"
/// wipe), restore defaults. If the user has customized, keep their list as the
/// sole source so removals stick — but always re-add EchoMind-hard excludes
/// via `is_ignored_bundle`.
pub fn effective_ignore_list(user_ignored: &[String]) -> Vec<String> {
    if user_ignored.is_empty() {
        return default_ignored_bundle_ids();
    }
    user_ignored.to_vec()
}

/// Resolve a raw mic-holding process into a stable app identity.
pub fn resolve_mic_process(raw: &MicHoldingProcess) -> Option<ResolvedMicApp> {
    let parent = resolve_helper_to_parent(&raw.bundle_id);
    // Bare binaries with no bundle id: use pid-scoped id so sessions still work.
    let app_id = if parent.is_empty() {
        format!("pid:{}", raw.pid)
    } else {
        parent.clone()
    };
    if is_echomind_bundle(&app_id) {
        return None;
    }
    let is_browser = is_browser_bundle_id(&app_id);
    let display_name = prefer_display_name(&app_id, &raw.display_name);
    let process_name = if raw.bundle_id.is_empty() {
        format!("pid:{}", raw.pid)
    } else {
        raw.bundle_id.clone()
    };
    Some(ResolvedMicApp {
        app_id,
        display_name,
        process_name,
        is_browser,
        pid: raw.pid,
    })
}

/// Build the recommended meeting title for a resolved app.
pub fn recommended_title(display_name: &str, date_str: &str) -> String {
    format!("{} Toplantısı - {}", display_name, date_str)
}

/// Parse the JSON array returned by the Swift bridge.
pub fn parse_mic_snapshot_json(json: &str) -> Result<Vec<MicHoldingProcess>, String> {
    serde_json::from_str(json).map_err(|e| format!("mic snapshot JSON: {e}"))
}

/// Platform probe + snapshot. Returns `None` when the OS can't say (older
/// macOS, no libpulse, bridge failure); the detector then detects nothing.
pub fn list_mic_holding_processes() -> Option<Vec<MicHoldingProcess>> {
    imp::list_mic_holding_processes()
}

#[cfg(target_os = "macos")]
mod imp {
    use super::*;
    use std::ffi::CStr;
    use std::os::raw::c_char;

    extern "C" {
        fn echomind_mic_proc_supported() -> i32;
        fn echomind_mic_proc_snapshot() -> *mut c_char;
        fn echomind_mic_proc_free(ptr: *mut c_char);
    }

    pub fn is_supported() -> bool {
        unsafe { echomind_mic_proc_supported() == 1 }
    }

    pub fn list_mic_holding_processes() -> Option<Vec<MicHoldingProcess>> {
        if !is_supported() {
            return None;
        }
        let ptr = unsafe { echomind_mic_proc_snapshot() };
        if ptr.is_null() {
            return None;
        }
        let json = unsafe {
            let s = CStr::from_ptr(ptr).to_string_lossy().into_owned();
            echomind_mic_proc_free(ptr);
            s
        };
        match parse_mic_snapshot_json(&json) {
            Ok(list) => Some(list),
            Err(err) => {
                eprintln!("⚠️ mic process snapshot parse failed: {err}");
                // Supported but parse failed — return empty rather than falling
                // back to the legacy gate (would miss real meetings).
                Some(Vec::new())
            }
        }
    }
}

/// Windows stores a desktop app's privacy entry under its full path with `#`
/// for every `\` ("C:#Program Files#Zoom#bin#Zoom.exe").
#[cfg(any(test, target_os = "windows"))]
fn windows_nonpackaged_path(key: &str) -> String {
    key.replace('#', "\\")
}

/// Whether `exe` belongs to the Store package `family` ("MSTeams_8wekyb3d8bbwe"):
/// packages install to `…\WindowsApps\<name>_<version>_<arch>__<publisher>\`.
#[cfg(any(test, target_os = "windows"))]
fn windows_package_owns_exe(family: &str, exe: &str) -> bool {
    let Some((name, publisher)) = family.rsplit_once('_') else {
        return false;
    };
    let exe = exe.to_ascii_lowercase();
    exe.contains(&format!("\\windowsapps\\{}_", name.to_ascii_lowercase()))
        && exe.contains(&format!("__{}\\", publisher.to_ascii_lowercase()))
}

#[cfg(target_os = "windows")]
mod imp {
    use super::*;
    use std::path::Path;
    use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
    use windows::core::{HSTRING, PWSTR};
    use windows::Win32::Foundation::ERROR_SUCCESS;
    use windows::Win32::System::Registry::{
        RegCloseKey, RegEnumKeyExW, RegGetValueW, RegOpenKeyExW, HKEY, HKEY_CURRENT_USER, KEY_READ,
        RRF_RT_REG_QWORD,
    };

    /// The per-user privacy store behind the taskbar "microphone in use" icon.
    const CONSENT_STORE: &str = r"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone";

    struct Key(HKEY);

    impl Key {
        fn open(parent: HKEY, path: &str) -> Option<Key> {
            let mut key = HKEY::default();
            // SAFETY: valid parent key and NUL-terminated path; closed in Drop.
            let status =
                unsafe { RegOpenKeyExW(parent, &HSTRING::from(path), 0, KEY_READ, &mut key) };
            (status == ERROR_SUCCESS).then_some(Key(key))
        }

        fn subkeys(&self) -> Vec<String> {
            let mut names = Vec::new();
            let mut buf = [0u16; 1024];
            for index in 0u32.. {
                let mut len = buf.len() as u32;
                // SAFETY: `buf` holds `len` UTF-16 units; the call writes at most that.
                let status = unsafe {
                    RegEnumKeyExW(
                        self.0,
                        index,
                        PWSTR(buf.as_mut_ptr()),
                        &mut len,
                        None,
                        PWSTR::null(),
                        None,
                        None,
                    )
                };
                if status != ERROR_SUCCESS {
                    break;
                }
                names.push(String::from_utf16_lossy(&buf[..len as usize]));
            }
            names
        }

        fn qword(&self, subkey: &str, value: &str) -> u64 {
            let mut data = 0u64;
            let mut size = std::mem::size_of::<u64>() as u32;
            // SAFETY: RRF_RT_REG_QWORD writes exactly 8 bytes into `data`.
            let status = unsafe {
                RegGetValueW(
                    self.0,
                    &HSTRING::from(subkey),
                    &HSTRING::from(value),
                    RRF_RT_REG_QWORD,
                    None,
                    Some(&mut data as *mut u64 as *mut std::ffi::c_void),
                    Some(&mut size),
                )
            };
            if status == ERROR_SUCCESS {
                data
            } else {
                0
            }
        }

        /// Windows clears `LastUsedTimeStop` when an app opens the microphone
        /// and sets it again when the app closes it.
        fn in_use(&self, subkey: &str) -> bool {
            self.qword(subkey, "LastUsedTimeStart") != 0
                && self.qword(subkey, "LastUsedTimeStop") == 0
        }
    }

    impl Drop for Key {
        fn drop(&mut self) {
            // SAFETY: opened in `Key::open` and not closed since.
            unsafe {
                let _ = RegCloseKey(self.0);
            }
        }
    }

    enum Holder {
        /// A desktop app, by full executable path.
        Exe(String),
        /// A Store app, by package family name.
        Package(String),
    }

    impl Holder {
        fn owns(&self, exe: &Path) -> bool {
            let exe = exe.to_string_lossy();
            match self {
                Holder::Exe(path) => exe.eq_ignore_ascii_case(path),
                Holder::Package(family) => windows_package_owns_exe(family, &exe),
            }
        }
    }

    pub fn list_mic_holding_processes() -> Option<Vec<MicHoldingProcess>> {
        // The store appears with the first app that asks for the microphone;
        // until then nobody holds it.
        let Some(store) = Key::open(HKEY_CURRENT_USER, CONSENT_STORE) else {
            return Some(Vec::new());
        };
        let mut holders = Vec::new();
        for name in store.subkeys() {
            if name == "NonPackaged" {
                if let Some(desktop) = Key::open(store.0, "NonPackaged") {
                    for key in desktop.subkeys() {
                        if desktop.in_use(&key) {
                            holders.push(Holder::Exe(windows_nonpackaged_path(&key)));
                        }
                    }
                }
            } else if store.in_use(&name) {
                holders.push(Holder::Package(name));
            }
        }
        if holders.is_empty() {
            return Some(Vec::new());
        }

        // An app that crashed mid-call never clears its entry, so only count
        // holders that are still running (and learn their pid and exe).
        let mut sys = System::new();
        sys.refresh_processes_specifics(
            ProcessesToUpdate::All,
            ProcessRefreshKind::new().with_exe(UpdateKind::OnlyIfNotSet),
        );
        let mut found = Vec::new();
        for holder in &holders {
            let running = sys.processes().values().find_map(|p| {
                let exe = p.exe()?;
                holder
                    .owns(exe)
                    .then(|| (p.pid().as_u32() as i32, exe.to_path_buf()))
            });
            let Some((pid, exe)) = running else {
                continue;
            };
            let file = exe
                .file_name()
                .map(|f| f.to_string_lossy().into_owned())
                .unwrap_or_default();
            let bundle_id = match holder {
                // A known app keeps its usual id; any other Store app is
                // named by its package, which is what users would ignore.
                Holder::Package(family) if known_app_id(&file).is_none() => family.clone(),
                _ => canonical_app_id(&file),
            };
            let display_name = exe
                .file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_default();
            found.push(MicHoldingProcess {
                pid,
                bundle_id,
                display_name,
            });
        }
        Some(found)
    }
}

#[cfg(target_os = "linux")]
mod imp {
    use super::*;
    use libloading::Library;
    use std::collections::HashSet;
    use std::ffi::{c_char, c_int, c_void, CStr};
    use std::sync::{Mutex, OnceLock};

    const PA_CONTEXT_READY: c_int = 4;
    const PA_CONTEXT_FAILED: c_int = 5;
    const PA_CONTEXT_TERMINATED: c_int = 6;
    const PA_OPERATION_RUNNING: c_int = 0;
    const PA_CHANNELS_MAX: usize = 32;

    #[repr(C)]
    struct SampleSpec {
        format: c_int,
        rate: u32,
        channels: u8,
    }

    #[repr(C)]
    struct ChannelMap {
        channels: u8,
        map: [c_int; PA_CHANNELS_MAX],
    }

    /// The leading fields of `pa_source_output_info` (one recording stream),
    /// up to `corked`.
    #[repr(C)]
    pub(super) struct SourceOutputInfo {
        index: u32,
        name: *const c_char,
        owner_module: u32,
        client: u32,
        source: u32,
        sample_spec: SampleSpec,
        channel_map: ChannelMap,
        buffer_usec: u64,
        source_usec: u64,
        resample_method: *const c_char,
        driver: *const c_char,
        proplist: *const c_void,
        corked: c_int,
    }

    /// The leading fields of `pa_source_info`, up to `index`.
    #[repr(C)]
    struct SourceInfo {
        name: *const c_char,
        index: u32,
    }

    type ListCallback<T> =
        extern "C" fn(c: *mut c_void, info: *const T, eol: c_int, userdata: *mut c_void);
    type ListFn<T> = unsafe extern "C" fn(
        c: *mut c_void,
        cb: ListCallback<T>,
        userdata: *mut c_void,
    ) -> *mut c_void;

    struct Api {
        mainloop_new: unsafe extern "C" fn() -> *mut c_void,
        mainloop_get_api: unsafe extern "C" fn(m: *mut c_void) -> *mut c_void,
        mainloop_iterate:
            unsafe extern "C" fn(m: *mut c_void, block: c_int, retval: *mut c_int) -> c_int,
        mainloop_free: unsafe extern "C" fn(m: *mut c_void),
        context_new: unsafe extern "C" fn(api: *mut c_void, name: *const c_char) -> *mut c_void,
        context_connect: unsafe extern "C" fn(
            c: *mut c_void,
            server: *const c_char,
            flags: c_int,
            api: *const c_void,
        ) -> c_int,
        context_get_state: unsafe extern "C" fn(c: *mut c_void) -> c_int,
        context_disconnect: unsafe extern "C" fn(c: *mut c_void),
        context_unref: unsafe extern "C" fn(c: *mut c_void),
        source_list: ListFn<SourceInfo>,
        source_output_list: ListFn<SourceOutputInfo>,
        operation_get_state: unsafe extern "C" fn(o: *mut c_void) -> c_int,
        operation_unref: unsafe extern "C" fn(o: *mut c_void),
        proplist_gets: unsafe extern "C" fn(p: *const c_void, key: *const c_char) -> *const c_char,
        _lib: Library,
    }

    /// libpulse, from PulseAudio or PipeWire's pipewire-pulse; `None` when
    /// neither is installed.
    fn api() -> Option<&'static Api> {
        static API: OnceLock<Option<Api>> = OnceLock::new();
        API.get_or_init(|| {
            // SAFETY: a plain C library without load-time side effects; the
            // symbols are looked up with their documented signatures.
            unsafe {
                let l = Library::new("libpulse.so.0").ok()?;
                Some(Api {
                    mainloop_new: *l.get(b"pa_mainloop_new\0").ok()?,
                    mainloop_get_api: *l.get(b"pa_mainloop_get_api\0").ok()?,
                    mainloop_iterate: *l.get(b"pa_mainloop_iterate\0").ok()?,
                    mainloop_free: *l.get(b"pa_mainloop_free\0").ok()?,
                    context_new: *l.get(b"pa_context_new\0").ok()?,
                    context_connect: *l.get(b"pa_context_connect\0").ok()?,
                    context_get_state: *l.get(b"pa_context_get_state\0").ok()?,
                    context_disconnect: *l.get(b"pa_context_disconnect\0").ok()?,
                    context_unref: *l.get(b"pa_context_unref\0").ok()?,
                    source_list: *l.get(b"pa_context_get_source_info_list\0").ok()?,
                    source_output_list: *l.get(b"pa_context_get_source_output_info_list\0").ok()?,
                    operation_get_state: *l.get(b"pa_operation_get_state\0").ok()?,
                    operation_unref: *l.get(b"pa_operation_unref\0").ok()?,
                    proplist_gets: *l.get(b"pa_proplist_gets\0").ok()?,
                    _lib: l,
                })
            }
        })
        .as_ref()
    }

    /// A connection to the sound server, kept between scans.
    struct Connection {
        api: &'static Api,
        mainloop: *mut c_void,
        context: *mut c_void,
    }

    // SAFETY: only used behind the CONNECTION mutex, one thread at a time.
    unsafe impl Send for Connection {}

    impl Connection {
        fn open(api: &'static Api) -> Option<Self> {
            // SAFETY: standard libpulse mainloop/context setup; freed in Drop.
            unsafe {
                let mainloop = (api.mainloop_new)();
                if mainloop.is_null() {
                    return None;
                }
                let context =
                    (api.context_new)((api.mainloop_get_api)(mainloop), c"EchoMind".as_ptr());
                let conn = Connection {
                    api,
                    mainloop,
                    context,
                };
                if context.is_null()
                    || (api.context_connect)(context, std::ptr::null(), 0, std::ptr::null()) < 0
                {
                    return None;
                }
                for _ in 0..1000 {
                    match (api.context_get_state)(context) {
                        PA_CONTEXT_READY => return Some(conn),
                        PA_CONTEXT_FAILED | PA_CONTEXT_TERMINATED => return None,
                        _ => {
                            if (api.mainloop_iterate)(mainloop, 1, std::ptr::null_mut()) < 0 {
                                return None;
                            }
                        }
                    }
                }
                None
            }
        }

        fn ready(&self) -> bool {
            // SAFETY: the context lives as long as `self`.
            unsafe { (self.api.context_get_state)(self.context) == PA_CONTEXT_READY }
        }

        /// Runs one list query to completion; `false` if it could not start.
        fn list<T, D>(&mut self, query: ListFn<T>, cb: ListCallback<T>, out: &mut D) -> bool {
            // SAFETY: `out` outlives the operation, which is driven to the end
            // (or abandoned) on this thread before returning.
            unsafe {
                let op = query(self.context, cb, out as *mut D as *mut c_void);
                if op.is_null() {
                    return false;
                }
                let mut spins = 0;
                while (self.api.operation_get_state)(op) == PA_OPERATION_RUNNING && spins < 1000 {
                    if (self.api.mainloop_iterate)(self.mainloop, 1, std::ptr::null_mut()) < 0 {
                        break;
                    }
                    spins += 1;
                }
                (self.api.operation_unref)(op);
                true
            }
        }
    }

    impl Drop for Connection {
        fn drop(&mut self) {
            // SAFETY: created in `open` and not freed since.
            unsafe {
                if !self.context.is_null() {
                    (self.api.context_disconnect)(self.context);
                    (self.api.context_unref)(self.context);
                }
                (self.api.mainloop_free)(self.mainloop);
            }
        }
    }

    /// One recording stream, as the server describes it.
    struct Stream {
        source: u32,
        corked: bool,
        pid: i32,
        binary: String,
        name: String,
    }

    fn text(ptr: *const c_char) -> String {
        if ptr.is_null() {
            String::new()
        } else {
            // SAFETY: libpulse strings are NUL-terminated and valid during the callback.
            unsafe { CStr::from_ptr(ptr).to_string_lossy().into_owned() }
        }
    }

    extern "C" fn on_source(
        _c: *mut c_void,
        info: *const SourceInfo,
        eol: c_int,
        userdata: *mut c_void,
    ) {
        if eol != 0 || info.is_null() {
            return;
        }
        // SAFETY: `userdata` is the HashSet passed to `list`; `info` is valid here.
        unsafe {
            // Monitors play back what an output plays: recording one is
            // capturing system audio (EchoMind does), not using the microphone.
            if text((*info).name).ends_with(".monitor") {
                (*(userdata as *mut HashSet<u32>)).insert((*info).index);
            }
        }
    }

    extern "C" fn on_stream(
        _c: *mut c_void,
        info: *const SourceOutputInfo,
        eol: c_int,
        userdata: *mut c_void,
    ) {
        if eol != 0 || info.is_null() {
            return;
        }
        let Some(api) = api() else { return };
        // SAFETY: `userdata` is the Vec passed to `list`; `info` and its
        // proplist are valid for the duration of the callback.
        unsafe {
            let info = &*info;
            let prop = |key: &CStr| text((api.proplist_gets)(info.proplist, key.as_ptr()));
            (*(userdata as *mut Vec<Stream>)).push(Stream {
                source: info.source,
                corked: info.corked != 0,
                pid: prop(c"application.process.id").parse().unwrap_or(0),
                binary: prop(c"application.process.binary"),
                name: prop(c"application.name"),
            });
        }
    }

    /// The offsets libpulse uses on 64-bit Linux.
    #[test]
    fn stream_info_matches_the_c_layout() {
        assert_eq!(std::mem::offset_of!(SourceOutputInfo, source), 24);
        assert_eq!(std::mem::offset_of!(SourceOutputInfo, proplist), 208);
        assert_eq!(std::mem::offset_of!(SourceOutputInfo, corked), 216);
        assert_eq!(std::mem::offset_of!(SourceInfo, index), 8);
    }

    fn connection() -> &'static Mutex<Option<Connection>> {
        static CONNECTION: OnceLock<Mutex<Option<Connection>>> = OnceLock::new();
        CONNECTION.get_or_init(|| Mutex::new(None))
    }

    pub fn list_mic_holding_processes() -> Option<Vec<MicHoldingProcess>> {
        let api = api()?;
        let mut guard = connection().lock().unwrap_or_else(|e| e.into_inner());
        if !guard.as_ref().is_some_and(Connection::ready) {
            *guard = Connection::open(api);
        }
        let conn = guard.as_mut()?;

        let mut monitors: HashSet<u32> = HashSet::new();
        let mut streams: Vec<Stream> = Vec::new();
        if !conn.list(api.source_list, on_source, &mut monitors)
            || !conn.list(api.source_output_list, on_stream, &mut streams)
        {
            *guard = None;
            return None;
        }

        let own_pid = std::process::id() as i32;
        Some(
            streams
                .into_iter()
                .filter(|s| !s.corked && !monitors.contains(&s.source) && s.pid != own_pid)
                .map(|s| {
                    let id_source = if s.binary.is_empty() {
                        &s.name
                    } else {
                        &s.binary
                    };
                    MicHoldingProcess {
                        pid: s.pid,
                        bundle_id: if id_source.is_empty() {
                            String::new()
                        } else {
                            canonical_app_id(id_source)
                        },
                        display_name: if s.name.is_empty() { s.binary } else { s.name },
                    }
                })
                .collect(),
        )
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
mod imp {
    use super::*;
    pub fn list_mic_holding_processes() -> Option<Vec<MicHoldingProcess>> {
        None
    }
}

/// Process-wide monotonic clock origin for the tracker (ms).
pub fn tracker_now_ms() -> u64 {
    use std::sync::OnceLock;
    use std::time::Instant;
    static START: OnceLock<Instant> = OnceLock::new();
    let start = START.get_or_init(Instant::now);
    start.elapsed().as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    fn app(id: &str, name: &str) -> ResolvedMicApp {
        ResolvedMicApp {
            app_id: id.to_string(),
            display_name: name.to_string(),
            process_name: id.to_string(),
            is_browser: false,
            pid: 42,
        }
    }

    #[test]
    fn debounce_requires_continuous_hold_before_reporting() {
        let mut t = MicHoldTracker::new();
        let zoom = vec![app("us.zoom.xos", "Zoom")];

        let s0 = t.tick(0, &zoom);
        assert!(s0.active.is_empty());
        assert!(s0.newly_reported.is_empty());

        let s1 = t.tick(4_000, &zoom);
        assert!(s1.active.is_empty(), "under 5s must not report");

        let s2 = t.tick(5_000, &zoom);
        assert_eq!(s2.active.len(), 1);
        assert_eq!(s2.newly_reported.len(), 1);
        assert_eq!(s2.newly_reported[0].app_id, "us.zoom.xos");

        // Same session: not newly reported again.
        let s3 = t.tick(6_000, &zoom);
        assert_eq!(s3.active.len(), 1);
        assert!(s3.newly_reported.is_empty());
    }

    #[test]
    fn debounce_drop_grace_keeps_session_then_ends() {
        let mut t = MicHoldTracker::new();
        let zoom = vec![app("us.zoom.xos", "Zoom")];
        let _ = t.tick(0, &zoom);
        let _ = t.tick(5_000, &zoom);

        // Mic drops briefly.
        let s_soft = t.tick(5_500, &[]);
        assert_eq!(s_soft.active.len(), 1, "within grace still active");
        assert!(s_soft.ended.is_empty());

        // Past grace → ended, one prompt-per-session resets.
        let s_end = t.tick(5_500 + MIC_DROP_GRACE.as_millis() as u64 + 1, &[]);
        assert!(s_end.active.is_empty());
        assert_eq!(s_end.ended, vec!["us.zoom.xos".to_string()]);

        // New hold after end is a fresh session (must wait threshold again).
        let s_new = t.tick(10_000, &zoom);
        assert!(s_new.active.is_empty());
        let s_ready = t.tick(15_000, &zoom);
        assert_eq!(s_ready.newly_reported.len(), 1);
    }

    #[test]
    fn helper_resolves_to_parent_browser() {
        assert_eq!(
            resolve_helper_to_parent("com.google.Chrome.helper"),
            "com.google.Chrome"
        );
        assert_eq!(
            resolve_helper_to_parent("com.google.Chrome.helper.GPU"),
            "com.google.Chrome"
        );
        assert_eq!(
            resolve_helper_to_parent("com.apple.WebKit.GPU"),
            "com.apple.Safari"
        );
        assert_eq!(
            resolve_helper_to_parent("com.brave.Browser.helper"),
            "com.brave.Browser"
        );
        assert_eq!(
            resolve_helper_to_parent("company.thebrowser.Browser.helper"),
            "company.thebrowser.Browser"
        );
        assert_eq!(
            resolve_helper_to_parent("com.microsoft.edgemac.helper"),
            "com.microsoft.edgemac"
        );
        assert_eq!(
            resolve_helper_to_parent("org.mozilla.firefox.helper"),
            "org.mozilla.firefox"
        );
        assert_eq!(resolve_helper_to_parent("us.zoom.xos"), "us.zoom.xos");
    }

    #[test]
    fn ignore_list_blocks_defaults_and_aliases() {
        let defaults = default_ignored_bundle_ids();
        assert!(is_ignored_bundle("com.apple.VoiceMemos", &defaults));
        assert!(is_ignored_bundle("com.apple.assistant_service", &defaults));
        assert!(is_ignored_bundle(ECHOMIND_BUNDLE_ID, &[]));
        assert!(is_ignored_bundle("com.echomind.assistant.dev", &[]));
        assert!(!is_ignored_bundle("us.zoom.xos", &defaults));
        assert!(is_ignored_bundle(
            "com.hnc.Discord",
            &["discord".to_string()]
        ));
        assert!(is_ignored_bundle(
            "us.zoom.xos",
            &["us.zoom.xos".to_string()]
        ));
    }

    #[test]
    fn effective_ignore_restores_defaults_when_empty() {
        let restored = effective_ignore_list(&[]);
        assert!(restored.contains(&"com.apple.VoiceMemos".to_string()));
        let custom = effective_ignore_list(&["us.zoom.xos".to_string()]);
        assert_eq!(custom, vec!["us.zoom.xos".to_string()]);
    }

    #[test]
    fn prefer_display_name_uses_known_hints() {
        assert_eq!(prefer_display_name("us.zoom.xos", "zoom.us"), "Zoom");
        assert_eq!(
            prefer_display_name("com.google.Chrome", "Google Chrome Helper"),
            "Google Chrome"
        );
        assert_eq!(
            prefer_display_name("com.example.WeirdApp", "WeirdApp Helper"),
            "WeirdApp"
        );
        assert_eq!(prefer_display_name("com.example.foo", "pid:12"), "foo");
    }

    #[test]
    fn resolve_mic_process_maps_helper_and_skips_echomind() {
        let chrome_helper = MicHoldingProcess {
            pid: 9,
            bundle_id: "com.google.Chrome.helper".into(),
            display_name: "Google Chrome Helper".into(),
        };
        let resolved = resolve_mic_process(&chrome_helper).unwrap();
        assert_eq!(resolved.app_id, "com.google.Chrome");
        assert!(resolved.is_browser);
        assert_eq!(resolved.display_name, "Google Chrome");

        let self_app = MicHoldingProcess {
            pid: 1,
            bundle_id: ECHOMIND_BUNDLE_ID.into(),
            display_name: "EchoMind".into(),
        };
        assert!(resolve_mic_process(&self_app).is_none());
    }

    #[test]
    fn parse_mic_snapshot_json_roundtrip() {
        let json = r#"[{"pid":55,"bundle_id":"us.zoom.xos","display_name":"Zoom"}]"#;
        let list = parse_mic_snapshot_json(json).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].pid, 55);
        assert_eq!(list[0].bundle_id, "us.zoom.xos");
    }

    #[test]
    fn windows_and_linux_names_map_to_the_same_app_ids() {
        assert_eq!(canonical_app_id("Zoom.exe"), "us.zoom.xos");
        assert_eq!(canonical_app_id("CptHost.exe"), "us.zoom.xos");
        assert_eq!(canonical_app_id("ms-teams.exe"), "com.microsoft.teams2");
        assert_eq!(canonical_app_id("teams-for-linux"), "com.microsoft.teams2");
        assert_eq!(canonical_app_id("chrome.exe"), "com.google.Chrome");
        assert_eq!(
            canonical_app_id("google-chrome-stable"),
            "com.google.Chrome"
        );
        assert_eq!(canonical_app_id("msedge.exe"), "com.microsoft.edgemac");
        assert_eq!(canonical_app_id("firefox"), "org.mozilla.firefox");
        assert_eq!(canonical_app_id("Discord.exe"), "com.hnc.Discord");
        assert_eq!(canonical_app_id("obs64.exe"), "com.obsproject.obs-studio");
        assert_eq!(canonical_app_id("SomeTool.exe"), "sometool");
        // EchoMind's own capture is never a meeting.
        assert!(is_echomind_bundle(&canonical_app_id("EchoMind.exe")));
        assert!(is_echomind_bundle(&canonical_app_id("echomind")));
        // Browsers stay browsers, so the "<Browser> Toplantısı" naming applies.
        assert!(is_browser_bundle_id(&canonical_app_id("chrome.exe")));
        // Ignore-list aliases work on Windows names too.
        assert!(is_ignored_bundle(
            &canonical_app_id("Zoom.exe"),
            &["zoom".into()]
        ));
    }

    #[test]
    fn windows_privacy_keys_resolve_to_executables() {
        assert_eq!(
            windows_nonpackaged_path("C:#Program Files#Zoom#bin#Zoom.exe"),
            r"C:\Program Files\Zoom\bin\Zoom.exe"
        );
        let teams = r"C:\Program Files\WindowsApps\MSTeams_24335.208.3315.1951_x64__8wekyb3d8bbwe\ms-teams.exe";
        assert!(windows_package_owns_exe("MSTeams_8wekyb3d8bbwe", teams));
        assert!(!windows_package_owns_exe(
            "MSTeamsBeta_8wekyb3d8bbwe",
            teams
        ));
        assert!(!windows_package_owns_exe("MSTeams_otherpublisher", teams));
        assert!(!windows_package_owns_exe("nounderscore", teams));
    }

    #[test]
    fn recommended_title_format() {
        assert_eq!(
            recommended_title("Webex", "01 October 2026"),
            "Webex Toplantısı - 01 October 2026"
        );
    }

    #[test]
    fn tracker_dedupes_same_session_across_helper_parent() {
        // Two ticks with the same resolved app_id (helper already collapsed).
        let mut t = MicHoldTracker::new();
        let a = vec![app("com.google.Chrome", "Google Chrome")];
        let _ = t.tick(0, &a);
        let ready = t.tick(5_000, &a);
        assert_eq!(ready.newly_reported.len(), 1);
        let again = t.tick(8_000, &a);
        assert!(again.newly_reported.is_empty());
        assert_eq!(again.active.len(), 1);
    }
}
