import { Newspaper } from "lucide-react";

import { changelogReleases } from "../changelogReleases";

export function ChangelogPage() {
  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h2 className="text-foreground text-xl">Changes</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Each shipped release bumps the minor version. Newest first.
        </p>
      </div>

      {changelogReleases.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card px-4 py-6 text-sm text-muted-foreground">
          No changelog entries yet.
        </div>
      ) : (
        changelogReleases.map((release) => (
          <section
            key={release.version}
            className="bg-card rounded-2xl border border-border overflow-hidden"
          >
            <div className="flex items-center gap-3 p-4 sm:p-5 border-b border-border">
              <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <Newspaper className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <h3 className="text-foreground tabular-nums">v{release.version}</h3>
                {release.date && (
                  <p className="text-xs text-muted-foreground mt-0.5">{release.date}</p>
                )}
              </div>
            </div>
            <ul className="px-4 sm:px-5 py-3 sm:py-4 space-y-2">
              {release.notes.map((note, index) => (
                <li
                  key={`${release.version}-${index}`}
                  className="text-sm text-muted-foreground leading-relaxed pl-4 relative"
                >
                  <span className="absolute left-0 top-[0.55em] w-1.5 h-1.5 rounded-full bg-primary/60" />
                  {note}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
