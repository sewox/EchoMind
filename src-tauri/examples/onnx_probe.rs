//! Prints an ONNX model's inputs, outputs and metadata (dev tool).
use tract_onnx::prelude::*;
fn main() -> TractResult<()> {
    let path = std::env::args()
        .nth(1)
        .expect("usage: onnx_probe <model.onnx>");
    let proto = tract_onnx::onnx().proto_model_for_path(&path)?;
    for p in &proto.metadata_props {
        println!("meta {} = {}", p.key, p.value);
    }
    let model = tract_onnx::onnx().model_for_path(&path)?;
    for i in model.input_outlets()? {
        println!(
            "input  {:?} {:?}",
            model.node(i.node).name,
            model.outlet_fact(*i)?
        );
    }
    for o in model.output_outlets()? {
        println!(
            "output {:?} {:?}",
            model.node(o.node).name,
            model.outlet_fact(*o)?
        );
    }
    let t = std::time::Instant::now();
    let _ =
        echomind_lib::speaker_embedding::SpeakerEmbedder::load(std::path::Path::new(&path), 150)
            .unwrap();
    println!("embedder load: {:.2}s", t.elapsed().as_secs_f32());
    Ok(())
}
