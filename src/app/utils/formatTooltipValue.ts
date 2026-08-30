/**
 * Format numeric chart tooltip values — avoids long float strings like 17.999987897897.
 */
export function formatTooltipNumber(value: unknown, decimals = 2): string {
  if (value === null || value === undefined) return "—";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return String(value);
  return n.toFixed(decimals);
}
