import { useCallback, useState } from "react";
import { Check, Copy, Globe, Loader2, Server } from "lucide-react";
import { getApiServerSettings, setApiServerSettings } from "../api/apiServer";
import { useSerialPolling } from "../hooks/useSerialPolling";
import type { ApiServerSettingsDto } from "../types/backend";

export function ApiServerSettings() {
  const [settings, setSettings] = useState<ApiServerSettingsDto | null>(null);
  const [portInput, setPortInput] = useState("18765");
  const [hostnameInput, setHostnameInput] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await getApiServerSettings();
      setSettings(next);
      setPortInput(String(next.port));
      setHostnameInput(next.hostname);
      setEnabled(next.enabled);
      setError(next.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load API settings");
    }
  }, []);

  useSerialPolling(refresh, {
    intervalMs: 15_000,
    hiddenIntervalMs: 60_000,
  });

  const save = async () => {
    const port = Number(portInput);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      setError("Port must be an integer between 1024 and 65535");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const next = await setApiServerSettings({
        enabled,
        port,
        hostname: hostnameInput.trim(),
      });
      setSettings(next);
      setError(next.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save API settings");
    } finally {
      setSaving(false);
    }
  };

  const copyUrl = async () => {
    const url = settings?.apiBaseUrl;
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const statusLabel = !settings
    ? "Loading"
    : !settings.enabled
      ? "Disabled"
      : settings.running
        ? "Running"
        : "Failed";

  const statusClass = !settings
    ? "text-muted-foreground"
    : !settings.enabled
      ? "text-muted-foreground"
      : settings.running
        ? "text-emerald-500"
        : "text-red-500";

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-4 sm:px-5 py-4 border-b border-border flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
          <Server className="w-4 h-4" />
        </div>
        <div>
          <h3 className="text-foreground text-sm font-medium">Remote API</h3>
          <p className="text-xs text-muted-foreground">
            Expose activity data to a central dashboard on your LAN
          </p>
        </div>
      </div>

      <div className="px-4 sm:px-5 py-4 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm text-foreground">Enable HTTP server</p>
            <p className="text-xs text-muted-foreground">
              Binds on the local network for cron polling
            </p>
          </div>
          <button
            type="button"
            onClick={() => setEnabled((value) => !value)}
            className={`relative w-11 h-6 rounded-full transition-colors ${
              enabled ? "bg-primary" : "bg-secondary"
            }`}
            aria-pressed={enabled}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                enabled ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="space-y-1.5">
            <span className="text-xs text-muted-foreground">Port</span>
            <input
              type="number"
              min={1024}
              max={65535}
              value={portInput}
              onChange={(event) => setPortInput(event.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs text-muted-foreground">Hostname label</span>
            <input
              type="text"
              value={hostnameInput}
              onChange={(event) => setHostnameInput(event.target.value)}
              placeholder="Optional display name"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            />
          </label>
        </div>

        <div className="rounded-lg border border-border/70 bg-secondary/30 px-3 py-3 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm text-foreground">
              <Globe className="w-4 h-4 text-muted-foreground" />
              <span>Status:</span>
              <span className={statusClass}>{statusLabel}</span>
            </div>
            {settings?.listenAddr && (
              <span className="text-xs text-muted-foreground">{settings.listenAddr}</span>
            )}
          </div>
          {settings?.apiBaseUrl && (
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs text-foreground break-all">
                {settings.apiBaseUrl}
              </code>
              <button
                type="button"
                onClick={() => void copyUrl()}
                className="shrink-0 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          )}
        </div>

        {(error || settings?.error) && (
          <p className="text-xs text-red-500">{error ?? settings?.error}</p>
        )}

        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-60"
        >
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          Save API settings
        </button>
      </div>
    </div>
  );
}
