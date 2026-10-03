//! EchoMind fork of whisper-rs-sys.
//!
//! Builds whisper.cpp WITHOUT its own ggml and links it against the ggml that
//! llama-cpp-sys-2 builds, so the app contains exactly one ggml. Two copies
//! (whisper.cpp's and llama.cpp's, different versions) share symbol names: the
//! linker keeps one of them silently, and the other library then runs against
//! the wrong ggml (llama.cpp aborted, Whisper produced garbage).
//!
//! The vendored whisper.cpp is pinned to a commit whose ggml version matches
//! llama-cpp-sys-2's (see VENDORED.md). Bump both together.

use std::env;
use std::path::PathBuf;

fn main() {
    let out = PathBuf::from(env::var("OUT_DIR").unwrap());
    let target = env::var("TARGET").unwrap();

    // Published by llama-cpp-sys-2 (`links = "llama"`): <out>/lib/cmake, which
    // holds ggml's CMake package; headers are installed in <out>/include.
    let ggml_cmake_dir = PathBuf::from(
        env::var("DEP_LLAMA_GGML_CMAKE_DIR")
            .expect("llama-cpp-sys-2 did not publish its ggml (DEP_LLAMA_GGML_CMAKE_DIR)"),
    );
    let ggml_include = ggml_cmake_dir.join("../../include");

    // whisper-rs reads this as DEP_WHISPER_WHISPER_CPP_VERSION.
    println!("cargo:WHISPER_CPP_VERSION={}", whisper_cpp_version());

    println!("cargo:rerun-if-changed=wrapper.h");
    println!("cargo:rerun-if-changed=whisper.cpp");

    let bindings = bindgen::Builder::default()
        .rust_edition(bindgen::RustEdition::Edition2021)
        .rust_target(bindgen::RustTarget::stable(88, 0).unwrap())
        .header("wrapper.h")
        .clang_arg("-I./whisper.cpp/include")
        .clang_arg(format!("-I{}", ggml_include.display()))
        .parse_callbacks(Box::new(bindgen::CargoCallbacks::new()))
        .generate()
        .expect("Unable to generate whisper bindings");
    bindings
        .write_to_file(out.join("bindings.rs"))
        .expect("Couldn't write bindings");

    if env::var("DOCS_RS").is_ok() {
        return;
    }

    let mut config = cmake::Config::new("whisper.cpp");
    config
        .define("WHISPER_USE_SYSTEM_GGML", "ON")
        .define("CMAKE_PREFIX_PATH", &ggml_cmake_dir)
        .define("BUILD_SHARED_LIBS", "OFF")
        .define("WHISPER_BUILD_TESTS", "OFF")
        .define("WHISPER_BUILD_EXAMPLES", "OFF")
        .define("WHISPER_BUILD_SERVER", "OFF")
        .define("WHISPER_ALL_WARNINGS", "OFF")
        .define("WHISPER_ALL_WARNINGS_3RD_PARTY", "OFF")
        // Debug builds of whisper.cpp are unusably slow; always optimize.
        .profile("Release")
        .pic(true);
    if target.contains("windows") {
        config.cxxflag("/utf-8");
    }
    let dst = config.build();

    for dir in ["lib", "lib64"] {
        println!("cargo:rustc-link-search=native={}", dst.join(dir).display());
    }
    // Only whisper itself: ggml (and the C++ runtime, Metal, Accelerate) are
    // linked by llama-cpp-sys-2.
    println!("cargo:rustc-link-lib=static=whisper");
    if target.contains("windows") {
        println!("cargo:rustc-link-lib=advapi32");
    }
}

/// "MAJOR.MINOR.PATCH" from whisper.cpp's `set(WHISPER_VERSION_*)` lines.
fn whisper_cpp_version() -> String {
    let cmake =
        std::fs::read_to_string("whisper.cpp/CMakeLists.txt").expect("whisper.cpp CMakeLists");
    let part = |name: &str| {
        cmake
            .lines()
            .find_map(|l| {
                l.trim()
                    .strip_prefix(&format!("set(WHISPER_VERSION_{name} "))
            })
            .map(|v| v.trim_end_matches(')').trim().to_string())
            .unwrap_or_else(|| panic!("WHISPER_VERSION_{name} not found"))
    };
    format!("{}.{}.{}", part("MAJOR"), part("MINOR"), part("PATCH"))
}
