import { invoke } from "@tauri-apps/api/core";

export function hasTauriRuntime() {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

export async function invokeCommand<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  return invoke<T>(command, args);
}

export async function invokeWithFallback<T>(
  command: string,
  fallback: T | (() => T),
  args?: Record<string, unknown>,
): Promise<T> {
  if (hasTauriRuntime()) {
    return invokeCommand<T>(command, args);
  }

  return typeof fallback === "function"
    ? (fallback as () => T)()
    : fallback;
}
