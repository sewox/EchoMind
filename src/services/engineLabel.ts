const LOCAL_PREFIX =
  /^(?:Kendi\s+)?(?:Bilgisayarınızda|Cihazınızda|Cihazda|Yerel)\s*\((.+)\)$/u;

/**
 * Compact engine name for badges: the stored label ("🔒 Bilgisayarınızda
 * (Standart Mod)") repeats what the badge icon already says, so the leading
 * symbol and the "on this device" wrapper are dropped.
 */
export function shortEngineLabel(raw?: string | null): string {
  const trimmed = (raw ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
  const local = trimmed.match(LOCAL_PREFIX);
  return (local ? local[1] : trimmed) || "Whisper Small";
}
