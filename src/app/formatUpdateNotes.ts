const NOISE =
  /install-macos\.sh|gatekeeper|authenticode|windows protected|docs\/setup|see the assets|see the changes page/i;

function stripMarkdown(line: string): string {
  return line
    .replace(/^#{1,6}\s+/, "")
    .replace(/^[-*]\s+/, "")
    .replace(/^[0-9]+\.\s+/, "")
    .replace(/`+/g, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .trim();
}

export function formatUpdateNotes(
  raw: string,
  changelogNotes: string[] = [],
): string[] {
  const fromRelease: string[] = [];
  let inFence = false;

  for (const original of raw.split("\n")) {
    const trimmed = original.trim();
    if (trimmed.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence || !trimmed) continue;
    if (NOISE.test(trimmed)) continue;
    const cleaned = stripMarkdown(trimmed);
    if (!cleaned || NOISE.test(cleaned)) continue;
    if (cleaned.length > 180) continue;
    fromRelease.push(cleaned);
  }

  const unique = [...new Set(fromRelease.length ? fromRelease : changelogNotes)];
  return unique.slice(0, 6);
}
