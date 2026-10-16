import { invoke } from "@tauri-apps/api/core";

/**
 * Sends uncaught errors in the window to the app log (Settings > System >
 * Diagnostics Report), where a tester's report can show them.
 */
export function logWindowErrors(): void {
  if (typeof window === "undefined") return;
  const send = (message: string) => {
    invoke("log_frontend_error", { message }).catch(() => {});
  };
  window.addEventListener("error", (e) => {
    send(`${e.message} (${e.filename}:${e.lineno}:${e.colno})`);
  });
  window.addEventListener("unhandledrejection", (e) => {
    const reason = e.reason;
    send(
      `unhandled rejection: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`,
    );
  });
}
