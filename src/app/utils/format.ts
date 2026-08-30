export function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  return `${(bytes / Math.pow(k, i)).toFixed(decimals)} ${sizes[i]}`;
}

export function formatBps(bps: number): string {
  if (bps === 0) return "0 bps";
  const k = 1000;
  const sizes = ["bps", "Kbps", "Mbps", "Gbps"];
  const i = Math.min(Math.floor(Math.log(bps) / Math.log(k)), sizes.length - 1);
  return `${(bps / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export function formatMbps(bps: number): string {
  return `${(bps / 1_000_000).toFixed(1)} Mbps`;
}
