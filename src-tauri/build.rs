fn main() {
    link_swift_system_audio();
    tauri_build::build();
}

/// macOS only: link the Swift bridge (Core Audio process tap, Apple dictation).
/// Gated on host OS so Linux/Windows CI never needs the Swift toolchain or
/// the `swift-rs` build-dependency.
#[cfg(target_os = "macos")]
fn link_swift_system_audio() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        swift_rs::SwiftLinker::new("12.0")
            .with_package("EchoMindAudio", "./swift/EchoMindAudio/")
            .link();
        // The bridge uses Swift concurrency (async dictation API). Its runtime
        // is linked as @rpath/libswift_Concurrency.dylib and ships with macOS
        // 12+ in /usr/lib/swift; without this rpath the binary fails to load.
        println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
    }
}

#[cfg(not(target_os = "macos"))]
fn link_swift_system_audio() {}
