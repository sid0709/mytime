export interface ChangelogRelease {
  version: string;
  date?: string;
  notes: string[];
}

export function parseChangelog(markdown: string): ChangelogRelease[] {
  const sections = markdown.split(/^## /m).slice(1);
  const releases: ChangelogRelease[] = [];

  for (const section of sections) {
    const newline = section.indexOf("\n");
    const header = (newline === -1 ? section : section.slice(0, newline)).trim();
    const body = newline === -1 ? "" : section.slice(newline + 1);
    const match = header.match(/^\[?v?(\d+\.\d+\.\d+)\]?\s*[—–-]\s*(.*)$/);
    if (!match) continue;

    const notes = body
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("- ") || line.startsWith("* "))
      .map((line) => line.slice(2).trim())
      .filter(Boolean);

    releases.push({
      version: match[1],
      date: match[2]?.trim() || undefined,
      notes,
    });
  }

  return releases;
}
