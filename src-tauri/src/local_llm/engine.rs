//! In-process llama.cpp generation with JSON-schema constrained output.
//!
//! One model stays loaded between calls (loading takes a few seconds); a new
//! context is created per call. Generation is serialized by the model lock.

use super::catalog::{self, LlmModel};
use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::{LlamaChatMessage, LlamaModel};
use llama_cpp_2::sampling::LlamaSampler;
use llama_cpp_2::token::data::LlamaTokenData;
use llama_cpp_2::token::data_array::LlamaTokenDataArray;
use std::num::NonZeroU32;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};

/// Longest context we allocate (prompt + answer). ~2.5 h of Turkish speech.
pub const MAX_CONTEXT_TOKENS: usize = 32_768;
const BATCH: usize = 512;
/// Share of the progress bar spent reading the prompt; generation fills the rest.
const PROMPT_SHARE: f32 = 0.6;

pub const CANCELLED: &str = "Rapor üretimi iptal edildi.";

pub struct GenRequest<'a> {
    pub system: &'a str,
    pub user: &'a str,
    pub json_schema: &'a str,
    pub max_tokens: usize,
    /// Typical answer length, for the progress estimate only.
    pub expected_tokens: usize,
    pub cancel: Option<&'a AtomicBool>,
    pub on_progress: &'a (dyn Fn(f32) + Sync),
}

fn backend() -> Result<&'static LlamaBackend, String> {
    static BACKEND: OnceLock<Result<LlamaBackend, String>> = OnceLock::new();
    BACKEND
        .get_or_init(|| {
            let mut b =
                LlamaBackend::init().map_err(|e| format!("llama.cpp başlatılamadı: {e}"))?;
            // llama.cpp logs every tensor at load; keep the app log readable.
            b.void_logs();
            Ok(b)
        })
        .as_ref()
        .map_err(Clone::clone)
}

struct Loaded {
    key: &'static str,
    model: LlamaModel,
}

fn loaded() -> &'static Mutex<Option<Loaded>> {
    static LOADED: OnceLock<Mutex<Option<Loaded>>> = OnceLock::new();
    LOADED.get_or_init(|| Mutex::new(None))
}

/// Set on quit: a running generation stops at its next token.
static QUITTING: AtomicBool = AtomicBool::new(false);

/// Frees the loaded model (memory, GPU buffers) if no generation holds it.
pub fn unload() {
    if let Ok(mut guard) = loaded().try_lock() {
        guard.take();
    }
}

/// On quit: stops a running generation and frees the model, waiting at most
/// `timeout`. ggml-metal asserts if GPU resources are still alive when its
/// static destructors run, so `false` means the caller must exit without
/// running them.
pub fn shutdown(timeout: std::time::Duration) -> bool {
    QUITTING.store(true, Ordering::SeqCst);
    let deadline = std::time::Instant::now() + timeout;
    loop {
        if let Ok(mut guard) = loaded().try_lock() {
            guard.take();
            return true;
        }
        if std::time::Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
}

fn gpu_layers() -> u32 {
    // Metal on Apple silicon; elsewhere the shared ggml is CPU-only for now.
    if cfg!(target_os = "macos") {
        999
    } else {
        0
    }
}

fn threads() -> i32 {
    static THREADS: OnceLock<i32> = OnceLock::new();
    *THREADS.get_or_init(|| {
        let hw = crate::hardware::HardwareInfo::detect();
        // Physical cores: hyper-threads slow matrix work down.
        (hw.physical_cores.max(1) as i32).clamp(1, 16)
    })
}

/// Qwen 3.x answers after a "thinking" block; an empty one skips it.
fn skip_thinking(prompt: &mut String) {
    if prompt.ends_with("<|im_start|>assistant\n") {
        prompt.push_str("<think>\n\n</think>\n\n");
    }
}

/// Generates a JSON document that matches `req.json_schema`.
pub fn generate_json(spec: &LlmModel, req: &GenRequest) -> Result<String, String> {
    if QUITTING.load(Ordering::SeqCst) {
        return Err(CANCELLED.into());
    }
    let backend = backend()?;
    let mut guard = loaded()
        .lock()
        .map_err(|_| "Model kilidi bozuldu".to_string())?;
    if guard.as_ref().map(|l| l.key) != Some(spec.key) {
        guard.take();
        let path = catalog::path(spec);
        if !catalog::is_installed(spec) {
            return Err(format!("{} yüklü değil.", spec.name));
        }
        let params = LlamaModelParams::default().with_n_gpu_layers(gpu_layers());
        let model = LlamaModel::load_from_file(backend, &path, &params)
            .map_err(|e| format!("{} yüklenemedi: {e}", spec.name))?;
        *guard = Some(Loaded {
            key: spec.key,
            model,
        });
    }
    let model = &guard.as_ref().expect("model loaded above").model;

    let template = model
        .chat_template(None)
        .map_err(|e| format!("Sohbet şablonu yok: {e}"))?;
    let messages = [
        LlamaChatMessage::new("system".into(), req.system.into()).map_err(|e| e.to_string())?,
        LlamaChatMessage::new("user".into(), req.user.into()).map_err(|e| e.to_string())?,
    ];
    let mut prompt = model
        .apply_chat_template(&template, &messages, true)
        .map_err(|e| format!("Şablon uygulanamadı: {e}"))?;
    skip_thinking(&mut prompt);

    let vocab = model.vocab();
    let tokens = vocab.tokenize(prompt.as_bytes(), false, true);
    let n_ctx = tokens.len() + req.max_tokens + 16;
    let limit = MAX_CONTEXT_TOKENS.min(model.n_ctx_train() as usize);
    if n_ctx > limit {
        return Err(format!(
            "Toplantı yerel model için çok uzun ({} token, sınır {}).",
            tokens.len(),
            limit - req.max_tokens
        ));
    }

    let n_threads = threads();
    let ctx_params = LlamaContextParams::default()
        .with_n_ctx(NonZeroU32::new(n_ctx as u32))
        .with_n_batch(BATCH as u32)
        .with_n_ubatch(BATCH as u32)
        .with_n_threads(n_threads)
        .with_n_threads_batch(n_threads);
    let mut ctx = model
        .new_context(backend, ctx_params)
        .map_err(|e| format!("Model bağlamı oluşturulamadı: {e}"))?;

    let cancelled =
        || QUITTING.load(Ordering::SeqCst) || req.cancel.is_some_and(|c| c.load(Ordering::SeqCst));

    // Prompt.
    let mut batch = LlamaBatch::new(BATCH, 1);
    let mut pos = 0i32;
    for chunk in tokens.chunks(BATCH) {
        if cancelled() {
            return Err(CANCELLED.into());
        }
        batch.clear();
        for (i, tok) in chunk.iter().enumerate() {
            let last = pos as usize + i == tokens.len() - 1;
            batch
                .add(*tok, pos + i as i32, &[0], last)
                .map_err(|e| e.to_string())?;
        }
        ctx.decode(&mut batch)
            .map_err(|e| format!("Model girdiyi işleyemedi: {e}"))?;
        pos += chunk.len() as i32;
        (req.on_progress)(PROMPT_SHARE * pos as f32 / tokens.len() as f32);
    }

    // Answer: lazy grammar, as llama.cpp's own sampler does. Sample freely,
    // check only the chosen token against the schema, and constrain the whole
    // vocabulary only when it would break the schema (a few tokens per
    // answer). Constraining every step is ~4x slower.
    let grammar_str = llama_cpp_2::json_schema_to_grammar(req.json_schema)
        .map_err(|e| format!("Şema dönüştürülemedi: {e}"))?;
    let mut grammar = LlamaSampler::grammar(model, &grammar_str, "root")
        .map_err(|e| format!("Şema yüklenemedi: {e}"))?;
    let mut chain = LlamaSampler::chain_simple([
        LlamaSampler::top_k(40),
        LlamaSampler::temp(0.2),
        // Fixed seed: the same meeting gives the same report.
        LlamaSampler::dist(42),
    ]);

    let mut out: Vec<u8> = Vec::new();
    let mut idx = batch.n_tokens() - 1;
    for n_gen in 0..req.max_tokens {
        if cancelled() {
            return Err(CANCELLED.into());
        }
        let mut cur = ctx.token_data_array_ith(idx);
        cur.apply_sampler(&chain);
        let mut tok = cur.selected_token().ok_or("Örnekleme başarısız")?;
        let mut probe = LlamaTokenDataArray::new(vec![LlamaTokenData::new(tok, 1.0, 0.0)], false);
        probe.apply_sampler(&grammar);
        if !probe.data[0].logit().is_finite() {
            let mut cur = ctx.token_data_array_ith(idx);
            cur.apply_sampler(&grammar);
            cur.apply_sampler(&chain);
            tok = cur.selected_token().ok_or("Örnekleme başarısız")?;
        }
        grammar.accept(tok);
        chain.accept(tok);
        if vocab.is_eog(tok) {
            break;
        }
        out.extend(vocab.token_to_piece(tok, false, None));
        batch.clear();
        batch.add(tok, pos, &[0], true).map_err(|e| e.to_string())?;
        ctx.decode(&mut batch)
            .map_err(|e| format!("Model yanıt üretemedi: {e}"))?;
        pos += 1;
        idx = 0;
        let gen_share = (n_gen as f32 / req.expected_tokens.max(1) as f32).min(0.99);
        (req.on_progress)(PROMPT_SHARE + (1.0 - PROMPT_SHARE) * gen_share);
    }
    (req.on_progress)(1.0);
    String::from_utf8(out).map_err(|_| "Model geçersiz metin üretti".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn thinking_is_skipped_only_at_an_open_assistant_turn() {
        let mut p = "<|im_start|>user\nhi<|im_end|>\n<|im_start|>assistant\n".to_string();
        skip_thinking(&mut p);
        assert!(p.ends_with("<think>\n\n</think>\n\n"));
        let mut other = "<start_of_turn>model\n".to_string();
        skip_thinking(&mut other);
        assert_eq!(other, "<start_of_turn>model\n");
    }
}
