fn main() {
    println!("cycle,ok,err,mic,sys,buf,speaking");
    let mut ok_n = 0usize;
    let mut fail_n = 0usize;
    for i in 1..=20 {
        match echomind_lib::audio::start_audio_capture(None) {
            Ok(_st) => {
                std::thread::sleep(std::time::Duration::from_millis(300));
                let st2 = echomind_lib::audio::get_audio_status();
                let stop = echomind_lib::audio::stop_audio_capture();
                let ok = stop.is_ok();
                if ok {
                    ok_n += 1;
                } else {
                    fail_n += 1;
                }
                let err = match &stop {
                    Ok(_) => String::new(),
                    Err(e) => e.replace(',', ";"),
                };
                println!(
                    "{},{},{},{:.4},{:.4},{},{}",
                    i, ok, err, st2.mic_level, st2.sys_level, st2.buffered_samples, st2.is_speaking
                );
            }
            Err(e) => {
                fail_n += 1;
                println!("{},false,start:{},0,0,0,false", i, e.replace(',', ";"));
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(150));
    }
    eprintln!("SUMMARY ok={} fail={}", ok_n, fail_n);
}
