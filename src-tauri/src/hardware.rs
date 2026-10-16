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
    pub has_ane: bool,  // Apple Neural Engine
    pub has_gpu: bool,  // Whisper runs on a discrete GPU (Vulkan), off macOS
    pub has_avx2: bool, // CPU AVX2 instructions
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

        let (gpu_name, gpu_acceleration, has_ane, has_gpu) =
            Self::detect_gpu_and_acceleration(&cpu_brand, has_avx2);

        let summary_headline = if cfg!(target_os = "macos") && cfg!(target_arch = "aarch64") {
            format!(
                "Apple Silicon {} Metal Hızlandırma Aktif (ANE Desteği Var)",
                cpu_brand
            )
        } else if has_gpu {
            format!("{} Vulkan GPU Hızlandırma Aktif", gpu_name)
        } else if has_avx2 {
            format!("{} (AVX2 CPU Hızlandırması Aktif)", cpu_brand)
        } else {
            format!("{} (Standart Mod)", cpu_brand)
        };

        let recommended_ai_mode = if cfg!(target_os = "macos") && cfg!(target_arch = "aarch64") {
            "Yerel Whisper-Metal (TR/EN) + Yerel Gemma 2 (2B/9B GGUF) veya Gemini 1.5 Flash"
                .to_string()
        } else if has_gpu {
            "Yerel Whisper (Vulkan GPU) + Gemini 1.5 Flash (Online Özetleme)".to_string()
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
            has_gpu,
            has_avx2,
            summary_headline,
            recommended_ai_mode,
        }
    }

    fn detect_gpu_and_acceleration(
        _cpu_brand: &str,
        _has_avx2: bool,
    ) -> (String, String, bool, bool) {
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

        #[cfg(not(target_os = "macos"))]
        {
            // The GPU Whisper actually runs on, as ggml's Vulkan backend sees it.
            if let Some(name) = crate::transcriber::whisper_gpu_name() {
                return (name, "Vulkan GPU".to_string(), false, true);
            }
            #[cfg(target_os = "windows")]
            let gpu_name = get_windows_gpu_name();
            #[cfg(not(target_os = "windows"))]
            let gpu_name: Option<String> = None;
            let gpu_accel = if _has_avx2 {
                "CPU AVX2 Vector Acceleration".to_string()
            } else {
                "CPU Standard Execution".to_string()
            };
            (
                gpu_name.unwrap_or_else(|| "Standard GPU".to_string()),
                gpu_accel,
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

/// A display adapter as DXGI lists it.
#[cfg(target_os = "windows")]
struct Adapter {
    name: String,
    dedicated_mb: usize,
    driver: Option<String>,
    vendor: u32,
    software: bool,
}

#[cfg(target_os = "windows")]
fn windows_adapters() -> Vec<Adapter> {
    use windows::core::Interface;
    use windows::Win32::Graphics::Dxgi::{
        CreateDXGIFactory1, IDXGIDevice, IDXGIFactory1, DXGI_ADAPTER_FLAG_SOFTWARE,
    };
    let mut adapters = Vec::new();
    // SAFETY: COM calls on interfaces DXGI hands out; nothing outlives them.
    unsafe {
        let Ok(factory) = CreateDXGIFactory1::<IDXGIFactory1>() else {
            return adapters;
        };
        let mut index = 0;
        while let Ok(adapter) = factory.EnumAdapters1(index) {
            index += 1;
            let Ok(desc) = adapter.GetDesc1() else {
                continue;
            };
            let len = desc
                .Description
                .iter()
                .position(|&c| c == 0)
                .unwrap_or(desc.Description.len());
            // The user-mode driver version, as Device Manager shows it.
            let driver = adapter
                .CheckInterfaceSupport(&IDXGIDevice::IID)
                .ok()
                .map(|v| {
                    let v = v as u64;
                    format!(
                        "{}.{}.{}.{}",
                        v >> 48,
                        (v >> 32) & 0xffff,
                        (v >> 16) & 0xffff,
                        v & 0xffff
                    )
                });
            adapters.push(Adapter {
                name: String::from_utf16_lossy(&desc.Description[..len])
                    .trim()
                    .to_string(),
                dedicated_mb: desc.DedicatedVideoMemory / (1024 * 1024),
                driver,
                vendor: desc.VendorId,
                software: desc.Flags & DXGI_ADAPTER_FLAG_SOFTWARE.0 as u32 != 0,
            });
        }
    }
    adapters
}

/// The hardware adapter with the most dedicated memory (a discrete GPU over
/// the integrated one).
#[cfg(target_os = "windows")]
fn get_windows_gpu_name() -> Option<String> {
    windows_adapters()
        .into_iter()
        .filter(|a| !a.software)
        .max_by_key(|a| a.dedicated_mb)
        .map(|a| a.name)
}

/// The display adapters, one line each, for the diagnostics log. Windows
/// only; elsewhere ggml's device list says enough.
pub fn display_adapters() -> Vec<String> {
    #[cfg(target_os = "windows")]
    {
        windows_adapters()
            .into_iter()
            .map(|a| {
                format!(
                    "{} | {} MB ayrık bellek | sürücü {} | üretici {:04x}{}",
                    a.name,
                    a.dedicated_mb,
                    a.driver.as_deref().unwrap_or("?"),
                    a.vendor,
                    if a.software { " | yazılım" } else { "" }
                )
            })
            .collect()
    }
    #[cfg(not(target_os = "windows"))]
    {
        Vec::new()
    }
}

/// `nvidia-smi`'s view of NVIDIA GPUs (driver, memory, load), where the
/// driver installed it.
pub fn nvidia_smi() -> Option<String> {
    if cfg!(target_os = "macos") {
        return None;
    }
    let mut cmd = std::process::Command::new("nvidia-smi");
    cmd.args([
        "--query-gpu=name,driver_version,memory.total,memory.used,utilization.gpu",
        "--format=csv,noheader",
    ]);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let out = cmd.output().ok()?;
    out.status
        .success()
        .then(|| String::from_utf8_lossy(&out.stdout).into_owned())
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
