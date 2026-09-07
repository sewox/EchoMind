use serde::{Deserialize, Serialize};
use sysinfo::System;

#[cfg(target_os = "macos")]
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HardwareInfo {
    pub os_type: String,
    pub os_version: String,
    pub cpu_brand: String,
    pub cpu_arch: String,
    pub physical_cores: usize,
    pub logical_cores: usize,
    pub total_ram_gb: f64,
    pub gpu_name: String,
    pub gpu_acceleration: String,
    pub has_ane: bool,          // Apple Neural Engine
    pub has_cuda: bool,         // NVIDIA CUDA
    pub has_avx2: bool,         // CPU AVX2 instructions
    pub summary_headline: String,
    pub recommended_ai_mode: String,
}

impl HardwareInfo {
    pub fn detect() -> Self {
        let mut sys = System::new_all();
        sys.refresh_all();

        let os_type = System::name().unwrap_or_else(|| std::env::consts::OS.to_string());
        let os_version = System::os_version().unwrap_or_else(|| "Bilinmiyor".to_string());

        let cpu_arch = std::env::consts::ARCH.to_string();

        let cpu_brand = sys
            .cpus()
            .first()
            .map(|cpu| cpu.brand().trim().to_string())
            .filter(|brand| !brand.is_empty())
            .unwrap_or_else(|| {
                if cfg!(target_os = "macos") && cfg!(target_arch = "aarch64") {
                    get_macos_cpu_brand().unwrap_or_else(|| "Apple Silicon".to_string())
                } else {
                    "Unknown Processor".to_string()
                }
            });

        let logical_cores = sys.cpus().len();
        let physical_cores = sys.physical_core_count().unwrap_or(logical_cores);

        let total_ram_bytes = sys.total_memory();
        let total_ram_gb = (total_ram_bytes as f64) / (1024.0 * 1024.0 * 1024.0);

        let has_avx2 = is_avx2_supported();

        let (gpu_name, gpu_acceleration, has_ane, has_cuda) = Self::detect_gpu_and_acceleration(&cpu_brand, has_avx2);

        let summary_headline = if cfg!(target_os = "macos") && cfg!(target_arch = "aarch64") {
            format!("Apple Silicon {} Metal Hızlandırma Aktif (ANE Desteği Var)", cpu_brand)
        } else if has_cuda {
            format!("{} CUDA Hızlandırma Aktif", gpu_name)
        } else if has_avx2 {
            format!("{} (AVX2 CPU Hızlandırması Aktif)", cpu_brand)
        } else {
            format!("{} (Standart Mod)", cpu_brand)
        };

        let recommended_ai_mode = if cfg!(target_os = "macos") && cfg!(target_arch = "aarch64") {
            "Yerel Whisper-Metal (TR/EN) + Yerel Gemma 2 (2B/9B GGUF) veya Gemini 1.5 Flash".to_string()
        } else if has_cuda {
            "Yerel Whisper-CUDA + Yerel Gemma 2 (CUDA) / Gemini 1.5 Flash".to_string()
        } else {
            "Yerel Whisper-CPU (Turbo) + Gemini 1.5 Flash (Online Özetleme)".to_string()
        };

        HardwareInfo {
            os_type,
            os_version,
            cpu_brand,
            cpu_arch,
            physical_cores,
            logical_cores,
            total_ram_gb: (total_ram_gb * 10.0).round() / 10.0,
            gpu_name,
            gpu_acceleration,
            has_ane,
            has_cuda,
            has_avx2,
            summary_headline,
            recommended_ai_mode,
        }
    }

    fn detect_gpu_and_acceleration(_cpu_brand: &str, _has_avx2: bool) -> (String, String, bool, bool) {
        #[cfg(target_os = "macos")]
        {
            if cfg!(target_arch = "aarch64") {
                (
                    format!("Apple Metal GPU ({})", _cpu_brand),
                    "Apple Metal & ANE (CoreML / Metal API)".to_string(),
                    true,
                    false,
                )
            } else {
                (
                    "Intel Integrated / AMD Radeon".to_string(),
                    "Apple Metal (Intel)".to_string(),
                    false,
                    false,
                )
            }
        }

        #[cfg(target_os = "windows")]
        {
            let has_cuda = detect_windows_cuda();
            if has_cuda {
                let gpu_name = get_windows_gpu_name().unwrap_or_else(|| "NVIDIA GPU".to_string());
                let gpu_accel = "NVIDIA CUDA (cuBLAS / TensorRT)".to_string();
                (gpu_name, gpu_accel, false, true)
            } else {
                let gpu_name = get_windows_gpu_name().unwrap_or_else(|| "DirectX 12 / Vulkan GPU".to_string());
                let gpu_accel = if _has_avx2 {
                    "CPU AVX2 Vector Acceleration".to_string()
                } else {
                    "CPU Standard Execution".to_string()
                };
                (gpu_name, gpu_accel, false, false)
            }
        }

        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            (
                "Standard GPU".to_string(),
                "CPU Fallback".to_string(),
                false,
                false,
            )
        }
    }
}

fn is_avx2_supported() -> bool {
    #[cfg(target_arch = "x86_64")]
    {
        std::is_x86_feature_detected!("avx2")
    }
    #[cfg(not(target_arch = "x86_64"))]
    {
        false
    }
}

#[cfg(target_os = "macos")]
fn get_macos_cpu_brand() -> Option<String> {
    let output = Command::new("sysctl")
        .arg("-n")
        .arg("machdep.cpu.brand_string")
        .output()
        .ok()?;
    if output.status.success() {
        let brand = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !brand.is_empty() {
            return Some(brand);
        }
    }
    None
}

#[cfg(not(target_os = "macos"))]
fn get_macos_cpu_brand() -> Option<String> {
    None
}

#[cfg(target_os = "windows")]
fn detect_windows_cuda() -> bool {
    std::path::Path::new("C:\\Windows\\System32\\nvcuda.dll").exists()
}

#[cfg(target_os = "windows")]
fn get_windows_gpu_name() -> Option<String> {
    use std::process::Command;
    let output = Command::new("wmic")
        .args(["path", "win32_VideoController", "get", "name"])
        .output()
        .ok()?;
    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let lines: Vec<&str> = stdout.lines().map(|l| l.trim()).filter(|l| !l.is_empty() && *l != "Name").collect();
        if let Some(first) = lines.first() {
            return Some(first.to_string());
        }
    }
    None
}

#[tauri::command]
pub fn get_hardware_info() -> HardwareInfo {
    HardwareInfo::detect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hardware_detection() {
        let info = HardwareInfo::detect();
        println!("Hardware Detection Result: {:?}", info);
        assert!(!info.cpu_brand.is_empty());
        assert!(info.total_ram_gb > 0.0);
        assert!(info.logical_cores > 0);
    }
}
