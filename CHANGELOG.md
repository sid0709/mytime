# Changelog

All notable changes to MyTime are listed here. Versioning rules: `.cursor/VERSIONING.md`.

The in-app **Changes** page shows this file.

## 1.4.0 — 2026-09-01

- Made the Dashboard lighter: live density stays on Pulse, while Focus Correlator and the keyboard live on Activity Tracker.
- Smoother live UI — the 1-second quality tick no longer rebuilds charts or minute bars, and frosted-glass blur is gone from the header.

## 1.3.0 — 2026-08-29

- Redesigned the in-app update dialog: version pills, a short "what's new" list, and no raw GitHub markdown.

## 1.2.0 — 2026-08-29

- Release CI no longer fails when `TAURI_SIGNING_PRIVATE_KEY` is missing; installers still publish, and updater signatures are created only when that secret is set.

## 1.1.0 — 2026-08-29

- Added an in-app Changes page that reads this changelog.
- Added a versioning policy: every shipped change bumps the minor version and records it here.
- Automated GitHub Releases with macOS ad-hoc signing, a one-line Mac installer, updater quarantine cleanup, and optional Windows Authenticode secrets.

## 1.0.0 — 2026-08-29

- Initial tracked release of the local-first activity tracker (macOS and Windows).
