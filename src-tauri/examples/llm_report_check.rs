//! Dev tool: whisper.cpp (via the app's transcriber) and llama.cpp in ONE
//! binary, sharing one ggml. Whisper-transcribes the first 30 s of a
//! recording through the app code, then generates the meeting report from a
//! transcript file with a GGUF model, JSON-schema constrained.
//!
//! Usage: llm_report_check <audio> <model.gguf> <transcript.txt> <gpu_layers> <out.json>
use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::{LlamaChatMessage, LlamaModel};
use llama_cpp_2::sampling::LlamaSampler;
use llama_cpp_2::token::data::LlamaTokenData;
use llama_cpp_2::token::data_array::LlamaTokenDataArray;
use std::num::NonZeroU32;
use std::time::Instant;

const SYSTEM: &str = "Sen bir toplantı asistanısın. Sana numaralı bir toplantı dökümü verilecek. \
Döküm otomatik ses tanımadan geldiği için hatalı kelimeler içerebilir. \
Yalnızca dökümde gerçekten geçen bilgileri kullan; tahmin etme, uydurma. \
Konuşmacı isimleri bilinmiyorsa 'Konuşmacı N' etiketlerini kullan. \
Her görev ve karar için dayandığı bölüm numaralarını 'source_segments' alanına yaz. \
Tüm metinleri Türkçe yaz.";

const SCHEMA: &str = r#"{"type":"object","properties":{
"meeting_goal":{"type":"string"},"summary":{"type":"string"},
"key_decisions":{"type":"array","items":{"type":"object","properties":{"decision":{"type":"string"},"source_segments":{"type":"array","items":{"type":"integer"}}},"required":["decision","source_segments"]}},
"action_items":{"type":"array","items":{"type":"object","properties":{"task":{"type":"string"},"assignee":{"type":["string","null"]},"source_segments":{"type":"array","items":{"type":"integer"}}},"required":["task","assignee","source_segments"]}},
"topics":{"type":"array","items":{"type":"object","properties":{"title":{"type":"string"},"points":{"type":"array","items":{"type":"string"}}},"required":["title","points"]}},
"open_questions":{"type":"array","items":{"type":"string"}}},
"required":["meeting_goal","summary","key_decisions","action_items","topics","open_questions"]}"#;

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let (audio, gguf, transcript_path, gpu_layers, out) =
        (&a[1], &a[2], &a[3], a[4].parse::<u32>().unwrap(), &a[5]);

    // 1) Whisper through the app's own transcriber (same ggml symbols in play).
    let t = Instant::now();
    echomind_lib::transcriber::switch_transcription_model("small".into()).expect("whisper load");
    let (pcm, _) =
        echomind_lib::importer::decode_audio_file_to_pcm16k(std::path::Path::new(audio)).unwrap();
    let cancel = std::sync::atomic::AtomicBool::new(false);
    let segs = echomind_lib::transcriber::get_global_transcriber()
        .transcribe_pcm_batch(&pcm[..16000 * 30], "tr", &cancel)
        .expect("whisper transcribe");
    let whisper_text: Vec<String> = segs.iter().map(|s| s.text.clone()).collect();
    eprintln!(
        "WHISPER ({:.1}s): {}",
        t.elapsed().as_secs_f32(),
        whisper_text.join(" | ")
    );

    // 2) llama.cpp in-process.
    let backend = LlamaBackend::init().unwrap();
    let t = Instant::now();
    let model = LlamaModel::load_from_file(
        &backend,
        gguf,
        &LlamaModelParams::default().with_n_gpu_layers(gpu_layers),
    )
    .expect("load gguf");
    let load_s = t.elapsed().as_secs_f32();

    let transcript = std::fs::read_to_string(transcript_path).unwrap();
    let user = format!(
        "Aşağıdaki toplantı dökümünden bir toplantı raporu çıkar:\n\
- meeting_goal: toplantının amacı (tek cümle)\n- summary: 3-5 cümlelik özet\n\
- key_decisions: alınan kararlar (yoksa boş liste)\n\
- action_items: yapılacak işler; task, assignee (bilinmiyorsa null), source_segments\n\
- topics: konuşulan ana başlıklar ve kısa maddeler\n- open_questions: çözülmeden kalan sorular\n\n\
DÖKÜM:\n{transcript}"
    );
    let tmpl = model.chat_template(None).expect("chat template");
    let mut prompt = model
        .apply_chat_template(
            &tmpl,
            &[
                LlamaChatMessage::new("system".into(), SYSTEM.into()).unwrap(),
                LlamaChatMessage::new("user".into(), user).unwrap(),
            ],
            true,
        )
        .expect("apply template");
    // Qwen 3.x: skip the thinking phase (empty think block).
    if prompt.contains("<|im_start|>assistant") && !prompt.ends_with("</think>\n\n") {
        prompt.push_str("<think>\n\n</think>\n\n");
    }

    let n_threads = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4) as i32;
    let ctx_params = LlamaContextParams::default()
        .with_n_ctx(NonZeroU32::new(16384))
        .with_n_batch(2048)
        .with_n_ubatch(512)
        .with_n_threads(n_threads)
        .with_n_threads_batch(n_threads);
    let mut ctx = model.new_context(&backend, ctx_params).expect("context");

    let vocab = model.vocab();
    let tokens = vocab.tokenize(prompt.as_bytes(), false, true);
    let n_prompt = tokens.len();
    let t = Instant::now();
    let mut batch = LlamaBatch::new(2048, 1);
    let mut pos = 0i32;
    for chunk in tokens.chunks(2048) {
        batch.clear();
        for (i, tok) in chunk.iter().enumerate() {
            let last = pos as usize + i == n_prompt - 1;
            batch.add(*tok, pos + i as i32, &[0], last).unwrap();
        }
        ctx.decode(&mut batch).expect("prompt decode");
        pos += chunk.len() as i32;
    }
    let prompt_s = t.elapsed().as_secs_f32();

    let grammar_str = llama_cpp_2::json_schema_to_grammar(SCHEMA).expect("schema→grammar");
    let mut grammar = LlamaSampler::grammar(&model, &grammar_str, "root").expect("grammar");
    let mut chain = LlamaSampler::chain_simple([
        LlamaSampler::top_k(40),
        LlamaSampler::temp(0.2),
        LlamaSampler::dist(42),
    ]);

    let t = Instant::now();
    let mut out_bytes: Vec<u8> = Vec::new();
    let mut n_gen = 0;
    let mut resampled = 0;
    let mut idx = batch.n_tokens() - 1;
    while n_gen < 3000 {
        // Lazy grammar (as llama.cpp's common sampler does): sample freely,
        // check only the chosen token, and constrain the full vocabulary only
        // when that token would break the schema.
        let mut cur = ctx.token_data_array_ith(idx);
        cur.apply_sampler(&chain);
        let mut tok = cur.selected_token().expect("token");
        let mut probe = LlamaTokenDataArray::new(vec![LlamaTokenData::new(tok, 1.0, 0.0)], false);
        probe.apply_sampler(&grammar);
        if !probe.data[0].logit().is_finite() {
            resampled += 1;
            let mut cur = ctx.token_data_array_ith(idx);
            cur.apply_sampler(&grammar);
            cur.apply_sampler(&chain);
            tok = cur.selected_token().expect("token");
        }
        grammar.accept(tok);
        chain.accept(tok);
        if vocab.is_eog(tok) {
            break;
        }
        out_bytes.extend(vocab.token_to_piece(tok, false, None));
        batch.clear();
        batch.add(tok, pos, &[0], true).unwrap();
        ctx.decode(&mut batch).expect("gen decode");
        pos += 1;
        n_gen += 1;
        idx = 0;
    }
    eprintln!("grammar resampled {resampled} of {n_gen} tokens");
    let gen_s = t.elapsed().as_secs_f32();
    let text = String::from_utf8_lossy(&out_bytes).to_string();
    let valid = serde_json::from_str::<serde_json::Value>(&text).is_ok();
    let report: serde_json::Value =
        serde_json::from_str(&text).unwrap_or(serde_json::Value::String(text.clone()));
    let result = serde_json::json!({
        "gpu_layers": gpu_layers, "load_s": load_s, "prompt_tokens": n_prompt,
        "prompt_s": prompt_s, "gen_tokens": n_gen, "gen_s": gen_s,
        "total_s": load_s + prompt_s + gen_s, "valid_json": valid, "report": report,
    });
    std::fs::write(out, serde_json::to_string_pretty(&result).unwrap()).unwrap();
    println!(
        "LLAMA gpu_layers={gpu_layers}: load {load_s:.1}s, prompt {n_prompt} tok in {prompt_s:.1}s, \
gen {n_gen} tok in {gen_s:.1}s, valid_json={valid}"
    );

    // Free the Whisper context before exit: ggml-metal asserts if GPU
    // resources are still alive when its static destructors run (the app does
    // this in its quit handler).
    echomind_lib::transcriber::unload_transcription_model();
}
