# Versioning policy

MyTime uses **semver** (`MAJOR.MINOR.PATCH`). The shipped app version is `src-tauri/tauri.conf.json` → `version`. Keep `package.json` and `src-tauri/Cargo.toml` on the same number.

## Rule: any shipped change bumps MINOR

If a change will go out in a GitHub Release (code, UI, Tauri config, installer, updater), **increment MINOR and reset PATCH**:

`1.2.0` → `1.3.0`

Do this in the same change set. Do not merge shipped work at the previous version.

Also add a bullet under that version in [`CHANGELOG.md`](../CHANGELOG.md). The in-app **Changes** page renders that file.

## When to bump what

| Bump | When |
|---|---|
| **MINOR** (default) | Any shipped behavior, UI, or packaging change |
| **MAJOR** | Breaking change: data-incompatible DB/schema, dropped platform, or installers that cannot update in place |
| **PATCH** | Do not use for shipped product work. Reserved only for a re-cut of the same MINOR (broken artifact, missing asset) with **no** code behavior change |

Docs, comments, or `.cursor/` policy-only edits may skip a bump **if** they are not included in the app binary. If you also touch shipped files, bump MINOR once for the whole change set.

## Checklist (every shipped PR)

1. Bump `version` in `src-tauri/tauri.conf.json`, `package.json`, and `src-tauri/Cargo.toml`.
2. Add `## X.Y.0 — YYYY-MM-DD` (or bullets under that heading) in `CHANGELOG.md`.
3. Newest release stays at the top of `CHANGELOG.md`.
4. CI publishes GitHub Release `vX.Y.0` from `tauri.conf.json` on merge to `main` / `master`. Same version twice will not notify existing installs.

## Changelog format

```markdown
## 1.4.0 — 2026-08-29

- Short user-facing bullet.
- Another bullet.
```

Write what the user notices, not file lists.
