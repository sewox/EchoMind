//! Mic-activity based meeting detection helpers (macOS 14.2+).
//!
//! On supported macOS builds, Core Audio process objects report which other
//! processes currently hold microphone input. This module owns:
//! - FFI to the Swift bridge (`echomind_mic_proc_*`)
//! - Debounce / session state machine (~5 s hold, short drop grace)
//! - Default + user ignore lists
//! - Browser helper → parent app resolution
//! - Bundle-id → display-name hints (known meeting apps are hints only)
//!
//! Linux/Windows and older macOS never call into Core Audio here; `is_supported`
//! is false and the detector falls back to its legacy process-name scan.

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
];

/// A process currently reported by Core Audio as holding mic input.
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

/// Platform probe + snapshot. Returns `None` when unsupported (non-macOS,
/// older macOS, or bridge failure) so the detector can fall back.
pub fn list_mic_holding_processes() -> Option<Vec<MicHoldingProcess>> {
    imp::list_mic_holding_processes()
}

pub fn is_mic_process_listing_supported() -> bool {
    imp::is_supported()
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

#[cfg(not(target_os = "macos"))]
mod imp {
    use super::*;
    pub fn is_supported() -> bool {
        false
    }
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
