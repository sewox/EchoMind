#![allow(non_upper_case_globals)]
#![allow(non_camel_case_types)]
#![allow(non_snake_case)]

// whisper.cpp is built without its own ggml: keep llama-cpp-sys-2 (which
// provides the ggml static libraries) in the link even when the app does not
// call llama.cpp, and after whisper so its ggml symbols resolve.
extern crate llama_cpp_sys_2;

include!(concat!(env!("OUT_DIR"), "/bindings.rs"));
