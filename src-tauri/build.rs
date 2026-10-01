fn main() {
    link_swift_system_audio();
    tauri_build::build();
}

/// macOS only: link the Swift Core Audio process-tap bridge.
/// Gated on host OS so Linux/Windows CI never needs the Swift toolchain or
/// the `swift-rs` build-dependency.
#[cfg(target_os = "macos")]
fn link_swift_system_audio() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        swift_rs::SwiftLinker::new("11.0")
            .with_package("EchoMindAudio", "./swift/EchoMindAudio/")
            .link();
    }
}

#[cfg(not(target_os = "macos"))]
fn link_swift_system_audio() {}
