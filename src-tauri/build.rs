fn main() {
    link_swift_system_audio();
    delay_load_vulkan();
    tauri_build::build();
}

/// Windows: load vulkan-1.dll on first use instead of at start-up, so the app
/// still starts where no graphics driver provides it; the hook in
/// windows/vulkan_delay_load.c then keeps ggml on the CPU.
fn delay_load_vulkan() {
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let target_env = std::env::var("CARGO_CFG_TARGET_ENV").unwrap_or_default();
    if target_os != "windows" || target_env != "msvc" {
        return;
    }
    println!("cargo:rerun-if-changed=windows/vulkan_delay_load.c");
    cc::Build::new()
        .file("windows/vulkan_delay_load.c")
        .compile("echomind_vulkan_delay_load");
    println!("cargo:rustc-link-arg=/DELAYLOAD:vulkan-1.dll");
    println!("cargo:rustc-link-arg=delayimp.lib");
    // Nothing references the hook by name; keep the linker from skipping it
    // and falling back to the helper's default (none).
    println!("cargo:rustc-link-arg=/INCLUDE:__pfnDliFailureHook2");
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
