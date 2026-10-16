//! Checks the diagnostics log on this OS: prints, C-side whisper/ggml logs and
//! panics all land in the log file. Exits non-zero if one is missing.
//!
//! cargo run --example diag_log_check -- result.txt
//!
//! The result and the log's end go to the given file: once the log is
//! started, this process's own output may go only to the log.

use std::time::Duration;

fn main() {
    echomind_lib::diag_log::init();
    let marker = format!("diag-check-{}", std::process::id());

    println!("{marker} stdout");
    eprintln!("{marker} stderr");
    // whisper.cpp logs the failed open through its log callback.
    let missing = format!("{marker}-no-such-model.bin");
    let _ = whisper_rs::WhisperContext::new_with_params(
        &missing,
        whisper_rs::WhisperContextParameters::default(),
    );
    let _ = std::thread::spawn(move || panic!("{} panic", "diag-check")).join();
    for d in llama_cpp_2::list_llama_ggml_backend_devices() {
        println!("ggml device: {} / {}", d.backend, d.description);
    }
    std::thread::sleep(Duration::from_millis(500));

    let log = std::fs::read_to_string(echomind_lib::diag_log::log_dir().join("echomind.log"))
        .unwrap_or_default();
    let wanted = [
        format!("{marker} stdout"),
        format!("{marker} stderr"),
        missing,
        "diag-check panic".to_string(),
        "ggml device:".to_string(),
    ];
    let lost: Vec<&String> = wanted
        .iter()
        .filter(|w| !log.contains(w.as_str()))
        .collect();
    let tail: Vec<&str> = log.lines().rev().take(60).collect();
    let mut result = if lost.is_empty() {
        "OK\n".to_string()
    } else {
        format!("MISSING: {lost:?}\n")
    };
    result.push_str(&tail.into_iter().rev().collect::<Vec<_>>().join("\n"));
    if let Some(out) = std::env::args().nth(1) {
        std::fs::write(out, result).expect("write the result file");
    }
    std::process::exit(if lost.is_empty() { 0 } else { 1 });
}
