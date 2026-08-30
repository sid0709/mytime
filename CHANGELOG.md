# Changelog

All notable changes to MyTime are listed here. Versioning rules: `.cursor/VERSIONING.md`.

The in-app **Changes** page shows this file.

## 1.2.0 — 2026-08-29

- Release CI no longer fails when `TAURI_SIGNING_PRIVATE_KEY` is missing; installers still publish, and updater signatures are created only when that secret is set.

## 1.1.0 — 2026-08-29

- Added an in-app Changes page that reads this changelog.
- Added a versioning policy: every shipped change bumps the minor version and records it here.
- Automated GitHub Releases with macOS ad-hoc signing, a one-line Mac installer, updater quarantine cleanup, and optional Windows Authenticode secrets.

## 1.0.0 — 2026-08-29

- Initial tracked release of the local-first activity tracker (macOS and Windows).
