pub mod audio;
pub mod audio_clipper;
pub mod auto_tagger;
pub mod cloud_transcriber;
pub mod credentials;
pub mod cross_memory;
pub mod detector;
pub mod diarization;
pub mod dlp;
pub mod encrypted_storage;
pub mod hardware;
pub mod importer;
pub mod offline_engines;
pub mod player;
pub mod qa_e2e_tests;
pub mod security;
pub mod storage;
pub mod summarizer;
pub mod transcriber;
pub mod updater;

use credentials::{delete_secure_credential, get_secure_credential, save_secure_credential};
use dlp::redact_sensitive_text;
use security::{get_privacy_mode, set_privacy_mode};
use updater::{check_for_updates, download_and_install_update, open_release_url};

use audio::{
    get_audio_status, list_audio_devices, open_audio_midi_setup, start_audio_capture,
    start_meeting_recording, start_mic_preview, stop_audio_capture, stop_mic_preview,
};
use audio_clipper::clip_meeting_soundbite;
use cross_memory::{get_cross_meeting_memory_stats, search_cross_meeting_memory};
use detector::{
    check_active_meetings, get_detector_status, hide_island_window, show_island_window,
    show_main_window, start_meeting_detector, stop_meeting_detector, update_detector_settings,
};
use hardware::get_hardware_info;
use importer::{
    import_audio_file, pick_and_import_audio_file, pick_audio_file_dialog, process_audio_file_path,
    read_audio_file_bytes, retranscribe_meeting,
};
use player::{
    get_native_playback_status, pause_native_audio, play_native_audio, play_native_audio_at,
    seek_native_audio, stop_native_audio,
};
use storage::{
    add_meeting_tag, delete_meeting_by_id, get_all_meetings, get_all_tags, get_related_meetings,
    remove_meeting_tag, save_current_meeting, toggle_action_item_status,
    update_meeting_speaker_name, update_meeting_title,
};
use summarizer::{
    ask_global_assistant, clean_transcript_text, enhance_meeting_transcript,
    export_followup_bundle, export_meeting_action_items_csv, export_meeting_action_items_markdown,
    export_meeting_email_digest, export_meeting_followup_email, export_meeting_notes,
    export_meeting_notes_html, export_meeting_notes_slack, filter_meeting_filler_words,
    generate_live_suggestions, generate_meeting_ics, generate_meeting_summary,
    get_meeting_analytics, get_meeting_analytics_by_id, global_search_meetings,
    open_meeting_html_report, save_meeting_export_file, test_ollama_connection,
    translate_meeting_summary,
};
use transcriber::{
    clear_transcription_history, download_whisper_model, get_available_models, get_model_status,
    get_transcription_history, switch_transcription_model, transcribe_audio_buffer,
    unload_transcription_model,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            get_hardware_info,
            start_audio_capture,
            start_meeting_recording,
            stop_audio_capture,
            start_mic_preview,
            stop_mic_preview,
            get_audio_status,
            list_audio_devices,
            open_audio_midi_setup,
            transcribe_audio_buffer,
            get_transcription_history,
            clear_transcription_history,
            get_model_status,
            get_all_meetings,
            save_current_meeting,
            delete_meeting_by_id,
            import_audio_file,
            pick_and_import_audio_file,
            pick_audio_file_dialog,
            process_audio_file_path,
            retranscribe_meeting,
            read_audio_file_bytes,
            play_native_audio,
            play_native_audio_at,
            pause_native_audio,
            stop_native_audio,
            seek_native_audio,
            get_native_playback_status,
            start_meeting_detector,
            stop_meeting_detector,
            get_detector_status,
            update_detector_settings,
            check_active_meetings,
            show_island_window,
            hide_island_window,
            show_main_window,
            generate_meeting_summary,
            translate_meeting_summary,
            test_ollama_connection,
            export_meeting_notes,
            export_meeting_notes_html,
            export_meeting_notes_slack,
            export_meeting_action_items_csv,
            export_meeting_action_items_markdown,
            export_meeting_followup_email,
            export_meeting_email_digest,
            open_meeting_html_report,
            save_meeting_export_file,
            filter_meeting_filler_words,
            clean_transcript_text,
            get_meeting_analytics,
            get_meeting_analytics_by_id,
            clip_meeting_soundbite,
            global_search_meetings,
            search_cross_meeting_memory,
            get_cross_meeting_memory_stats,
            ask_global_assistant,
            update_meeting_speaker_name,
            update_meeting_title,
            toggle_action_item_status,
            enhance_meeting_transcript,
            unload_transcription_model,
            get_available_models,
            switch_transcription_model,
            download_whisper_model,
            save_secure_credential,
            get_secure_credential,
            delete_secure_credential,
            redact_sensitive_text,
            check_for_updates,
            download_and_install_update,
            open_release_url,
            set_privacy_mode,
            get_privacy_mode,
            generate_meeting_ics,
            export_followup_bundle,
            generate_live_suggestions,
            add_meeting_tag,
            remove_meeting_tag,
            get_related_meetings,
            get_all_tags
        ])
        .setup(|app| {
            #[cfg(debug_assertions)]
            {
                use tauri::Manager;
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.open_devtools();
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, event| {
            if let tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit = event {
                transcriber::get_global_transcriber().cleanup_context();
                audio::get_global_audio_engine().stop().ok();
                audio::get_global_audio_engine().stop_preview().ok();
            }
        });
}
