export interface HardwareInfo {
  os_type: string;
  os_version: string;
  cpu_brand: string;
  cpu_arch: string;
  physical_cores: number;
  logical_cores: number;
  total_ram_gb: number;
  gpu_name: string;
  gpu_acceleration: string;
  has_ane: boolean;
  has_cuda: boolean;
  has_avx2: boolean;
  summary_headline: string;
  recommended_ai_mode: string;
}
