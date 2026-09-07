pub mod audio;
pub mod cloud_transcriber;
pub mod detector;
pub mod diarization;
pub mod hardware;
pub mod importer;
pub mod offline_engines;
pub mod player;
pub mod qa_e2e_tests;
pub mod security;
pub mod storage;
pub mod summarizer;
pub mod transcriber;

use audio::{
    get_audio_status, list_audio_devices, open_audio_midi_setup, start_audio_capture,
    start_meeting_recording, start_mic_preview, stop_audio_capture, stop_mic_preview,
};
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
    delete_meeting_by_id, get_all_meetings, save_current_meeting, toggle_action_item_status,
    update_meeting_speaker_name, update_meeting_title,
};
use summarizer::{
    ask_global_assistant, enhance_meeting_transcript, export_meeting_action_items_csv,
    export_meeting_action_items_markdown, export_meeting_email_digest, export_meeting_followup_email,
    export_meeting_notes, export_meeting_notes_html, export_meeting_notes_slack,
    generate_meeting_summary, global_search_meetings, open_meeting_html_report,
    save_meeting_export_file, test_ollama_connection, translate_meeting_summary,
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
            global_search_meetings,
            ask_global_assistant,
            update_meeting_speaker_name,
            update_meeting_title,
            toggle_action_item_status,
            enhance_meeting_transcript,
            unload_transcription_model,
            get_available_models,
            switch_transcription_model,
            download_whisper_model
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, event| {
            if let tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit = event {
                transcriber::get_global_transcriber().cleanup_context();
            }
        });
}
