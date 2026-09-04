use rodio::{Decoder, OutputStream, Sink, Source};
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::BufReader;
use std::path::PathBuf;
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaybackStatus {
    pub is_playing: bool,
    pub current_time_secs: f32,
    pub duration_secs: f32,
    pub current_file: Option<String>,
}

#[allow(dead_code)]
enum PlayerCommand {
    Play(String, Sender<Result<PlaybackStatus, String>>),
    PlayAt(String, f32, Sender<Result<PlaybackStatus, String>>),
    Pause(Sender<PlaybackStatus>),
    Resume(Sender<PlaybackStatus>),
    Stop(Sender<PlaybackStatus>),
    Seek(f32, Sender<Result<PlaybackStatus, String>>),
    GetStatus(Sender<PlaybackStatus>),
}

pub struct PlayerHandle {
    sender: Sender<PlayerCommand>,
}

impl PlayerHandle {
    pub fn new() -> Self {
        let (tx, rx) = channel::<PlayerCommand>();

        thread::spawn(move || {
            let mut _stream: Option<OutputStream> = None;
            let mut sink: Option<Sink> = None;
            let mut current_file: Option<String> = None;
            let mut duration_secs: f32 = 0.0;
            let mut offset_secs: f32 = 0.0;

            let make_status = |s: &Option<Sink>, cur_f: &Option<String>, dur: f32, off: f32| -> PlaybackStatus {
                if let Some(ref active_sink) = s {
                    PlaybackStatus {
                        is_playing: !active_sink.is_paused() && !active_sink.empty(),
                        current_time_secs: off + active_sink.get_pos().as_secs_f32(),
                        duration_secs: dur,
                        current_file: cur_f.clone(),
                    }
                } else {
                    PlaybackStatus {
                        is_playing: false,
                        current_time_secs: 0.0,
                        duration_secs: 0.0,
                        current_file: None,
                    }
                }
            };

            while let Ok(cmd) = rx.recv() {
                match cmd {
                    PlayerCommand::Play(file_path, resp) => {
                        let mut path = PathBuf::from(&file_path);

                        if !path.exists() {
                            let storage_dir = crate::storage::get_storage_dir();
                            let filename = path.file_name().unwrap_or_default();
                            let alt_storage = storage_dir.join("recordings").join(filename);
                            if alt_storage.exists() {
                                path = alt_storage;
                            } else if let Ok(cwd) = std::env::current_dir() {
                                let alt1 = cwd.join(&file_path);
                                if alt1.exists() {
                                    path = alt1;
                                }
                            }
                        }

                        if !path.exists() {
                            let _ = resp.send(Err(format!("Ses dosyası bulunamadı: {}", file_path)));
                            continue;
                        }

                        // Toggle pause/play if already playing the same file
                        if current_file.as_deref() == Some(&file_path) {
                            if let Some(ref s) = sink {
                                if !s.empty() {
                                    if s.is_paused() {
                                        s.play();
                                    } else {
                                        s.pause();
                                    }
                                    let st = make_status(&sink, &current_file, duration_secs, offset_secs);
                                    let _ = resp.send(Ok(st));
                                    continue;
                                }
                            }
                        }

                        // Recreate output stream and sink if needed
                        if _stream.is_none() || sink.is_none() {
                            if let Ok((s, handle)) = OutputStream::try_default() {
                                _stream = Some(s);
                                if let Ok(s_new) = Sink::try_new(&handle) {
                                    sink = Some(s_new);
                                }
                            }
                        }

                        let file_open_res = File::open(&path);
                        match file_open_res {
                            Ok(file) => {
                                let reader = BufReader::new(file);
                                match Decoder::new(reader) {
                                    Ok(source) => {
                                        duration_secs = source
                                            .total_duration()
                                            .map(|d| d.as_secs_f32())
                                            .unwrap_or(0.0);
                                        offset_secs = 0.0;
                                        if let Some(ref current_sink) = sink {
                                            current_sink.stop();
                                            current_sink.append(source);
                                            current_sink.play();
                                            current_file = Some(file_path);
                                            let st = PlaybackStatus {
                                                is_playing: true,
                                                current_time_secs: 0.0,
                                                duration_secs,
                                                current_file: current_file.clone(),
                                            };
                                            let _ = resp.send(Ok(st));
                                        } else {
                                            let _ = resp.send(Err("Ses çıkış aygıtı (Sink) başlatılamadı".to_string()));
                                        }
                                    }
                                    Err(e) => {
                                        let _ = resp.send(Err(format!("Ses dekoderi hatası: {:?}", e)));
                                    }
                                }
                            }
                            Err(e) => {
                                let _ = resp.send(Err(format!("Ses dosyası okunamadı: {}", e)));
                            }
                        }
                    }
                    PlayerCommand::PlayAt(file_path, start_secs, resp) => {
                        let mut path = PathBuf::from(&file_path);

                        if !path.exists() {
                            let storage_dir = crate::storage::get_storage_dir();
                            let filename = path.file_name().unwrap_or_default();
                            let alt_storage = storage_dir.join("recordings").join(filename);
                            if alt_storage.exists() {
                                path = alt_storage;
                            } else if let Ok(cwd) = std::env::current_dir() {
                                let alt1 = cwd.join(&file_path);
                                if alt1.exists() {
                                    path = alt1;
                                }
                            }
                        }

                        if !path.exists() {
                            let _ = resp.send(Err(format!("Ses dosyası bulunamadı: {}", file_path)));
                            continue;
                        }

                        if _stream.is_none() || sink.is_none() {
                            if let Ok((s, handle)) = OutputStream::try_default() {
                                _stream = Some(s);
                                if let Ok(s_new) = Sink::try_new(&handle) {
                                    sink = Some(s_new);
                                }
                            }
                        }

                        match File::open(&path) {
                            Ok(file) => {
                                let reader = BufReader::new(file);
                                match Decoder::new(reader) {
                                    Ok(source) => {
                                        duration_secs = source
                                            .total_duration()
                                            .map(|d| d.as_secs_f32())
                                            .unwrap_or(0.0);
                                        offset_secs = start_secs.max(0.0);
                                        if let Some(ref current_sink) = sink {
                                            current_sink.stop();
                                            if offset_secs > 0.0 {
                                                let skipped = source.skip_duration(std::time::Duration::from_secs_f32(offset_secs));
                                                current_sink.append(skipped);
                                            } else {
                                                current_sink.append(source);
                                            }
                                            current_sink.play();
                                            current_file = Some(file_path);
                                            let st = PlaybackStatus {
                                                is_playing: true,
                                                current_time_secs: offset_secs,
                                                duration_secs,
                                                current_file: current_file.clone(),
                                            };
                                            let _ = resp.send(Ok(st));
                                        } else {
                                            let _ = resp.send(Err("Ses çıkış aygıtı (Sink) başlatılamadı".to_string()));
                                        }
                                    }
                                    Err(e) => {
                                        let _ = resp.send(Err(format!("Ses dekoderi hatası: {:?}", e)));
                                    }
                                }
                            }
                            Err(e) => {
                                let _ = resp.send(Err(format!("Dosya açılamadı: {}", e)));
                            }
                        }
                    }
                    PlayerCommand::Pause(resp) => {
                        if let Some(ref s) = sink {
                            s.pause();
                        }
                        let st = make_status(&sink, &current_file, duration_secs, offset_secs);
                        let _ = resp.send(st);
                    }
                    PlayerCommand::Resume(resp) => {
                        if let Some(ref s) = sink {
                            s.play();
                        }
                        let st = make_status(&sink, &current_file, duration_secs, offset_secs);
                        let _ = resp.send(st);
                    }
                    PlayerCommand::Stop(resp) => {
                        if let Some(ref s) = sink {
                            s.stop();
                        }
                        current_file = None;
                        duration_secs = 0.0;
                        offset_secs = 0.0;
                        let st = make_status(&sink, &current_file, duration_secs, offset_secs);
                        let _ = resp.send(st);
                    }
                    PlayerCommand::Seek(pos_secs, resp) => {
                        if let Some(ref file_path) = current_file {
                            let mut path = PathBuf::from(file_path);
                            if !path.exists() {
                                let storage_dir = crate::storage::get_storage_dir();
                                let filename = path.file_name().unwrap_or_default();
                                let alt_storage = storage_dir.join("recordings").join(filename);
                                if alt_storage.exists() {
                                    path = alt_storage;
                                }
                            }
                            if path.exists() {
                                if let Some(ref current_sink) = sink {
                                    current_sink.stop();
                                    if let Ok(file) = File::open(&path) {
                                        let reader = BufReader::new(file);
                                        if let Ok(source) = Decoder::new(reader) {
                                            offset_secs = pos_secs.max(0.0);
                                            if offset_secs > 0.0 {
                                                let skipped = source.skip_duration(std::time::Duration::from_secs_f32(offset_secs));
                                                current_sink.append(skipped);
                                            } else {
                                                current_sink.append(source);
                                            }
                                            current_sink.play();
                                            let st = PlaybackStatus {
                                                is_playing: true,
                                                current_time_secs: offset_secs,
                                                duration_secs,
                                                current_file: current_file.clone(),
                                            };
                                            let _ = resp.send(Ok(st));
                                            continue;
                                        }
                                    }
                                }
                            }
                        }
                        let st = make_status(&sink, &current_file, duration_secs, offset_secs);
                        let _ = resp.send(Ok(st));
                    }
                    PlayerCommand::GetStatus(resp) => {
                        let status = make_status(&sink, &current_file, duration_secs, offset_secs);
                        let _ = resp.send(status);
                    }
                }
            }
        });

        PlayerHandle { sender: tx }
    }

    pub fn play(&self, file_path: String) -> Result<PlaybackStatus, String> {
        let (tx, rx) = channel();
        self.sender
            .send(PlayerCommand::Play(file_path, tx))
            .map_err(|e| format!("Player thread hatası: {}", e))?;
        rx.recv().map_err(|e| format!("Playback yanıt hatası: {}", e))?
    }

    pub fn play_at(&self, file_path: String, start_secs: f32) -> Result<PlaybackStatus, String> {
        let (tx, rx) = channel();
        self.sender
            .send(PlayerCommand::PlayAt(file_path, start_secs, tx))
            .map_err(|e| format!("Player thread hatası: {}", e))?;
        rx.recv().map_err(|e| format!("Playback yanıt hatası: {}", e))?
    }

    pub fn pause(&self) -> Result<PlaybackStatus, String> {
        let (tx, rx) = channel();
        self.sender
            .send(PlayerCommand::Pause(tx))
            .map_err(|e| format!("Player thread hatası: {}", e))?;
        rx.recv().map_err(|e| format!("Playback yanıt hatası: {}", e))
    }

    pub fn stop(&self) -> Result<PlaybackStatus, String> {
        let (tx, rx) = channel();
        self.sender
            .send(PlayerCommand::Stop(tx))
            .map_err(|e| format!("Player thread hatası: {}", e))?;
        rx.recv().map_err(|e| format!("Playback yanıt hatası: {}", e))
    }

    pub fn seek(&self, position_seconds: f32) -> Result<PlaybackStatus, String> {
        let (tx, rx) = channel();
        self.sender
            .send(PlayerCommand::Seek(position_seconds, tx))
            .map_err(|e| format!("Player thread hatası: {}", e))?;
        rx.recv().map_err(|e| format!("Playback yanıt hatası: {}", e))?
    }

    pub fn get_status(&self) -> Result<PlaybackStatus, String> {
        let (tx, rx) = channel();
        self.sender
            .send(PlayerCommand::GetStatus(tx))
            .map_err(|e| format!("Player thread hatası: {}", e))?;
        rx.recv().map_err(|e| format!("Playback status error: {}", e))
    }
}

pub type SharedPlayerHandle = Arc<Mutex<PlayerHandle>>;

pub fn get_global_player() -> &'static SharedPlayerHandle {
    static PLAYER: OnceLock<SharedPlayerHandle> = OnceLock::new();
    PLAYER.get_or_init(|| Arc::new(Mutex::new(PlayerHandle::new())))
}

#[tauri::command]
pub fn play_native_audio(file_path: String) -> Result<PlaybackStatus, String> {
    let player = get_global_player();
    let lock = player.lock().unwrap();
    lock.play(file_path)
}

#[tauri::command]
pub fn play_native_audio_at(file_path: String, start_secs: f32) -> Result<PlaybackStatus, String> {
    let player = get_global_player();
    let lock = player.lock().unwrap();
    lock.play_at(file_path, start_secs)
}

#[tauri::command]
pub fn pause_native_audio() -> Result<PlaybackStatus, String> {
    let player = get_global_player();
    let lock = player.lock().unwrap();
    lock.pause()
}

#[tauri::command]
pub fn stop_native_audio() -> Result<PlaybackStatus, String> {
    let player = get_global_player();
    let lock = player.lock().unwrap();
    lock.stop()
}

#[tauri::command]
pub fn seek_native_audio(position_seconds: f32) -> Result<PlaybackStatus, String> {
    let player = get_global_player();
    let lock = player.lock().unwrap();
    lock.seek(position_seconds)
}

#[tauri::command]
pub fn get_native_playback_status() -> Result<PlaybackStatus, String> {
    let player = get_global_player();
    let lock = player.lock().unwrap();
    lock.get_status()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_player_handle_creation() {
        let handle = PlayerHandle::new();
        let status = handle.get_status().unwrap();
        assert!(!status.is_playing);
    }
}
