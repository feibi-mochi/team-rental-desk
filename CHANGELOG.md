# Changelog

All notable public changes to Team Rental Desk are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and public versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-08-10

### Added

- First public Windows 10/11 x64 release.
- Automatic detection of standard Chrome profiles and profile-pinned Windows shortcuts for opening the matching signed-in account environment.
- Local management for spaces, mother accounts, and up to two child seats per space.
- Payment cycles, partial payments, platform fees, renewals, frozen exchange-rate snapshots, and auditable reversals.
- Operations overview with receivables, actual income, projected profit, expiry status, cost coverage, monthly history, and per-space performance.
- Separate archive views for spaces and child seats, with guarded restore and history-preserving removal.
- Payment-method management and combined currency/rate management with safe currency removal.
- Verified SQLite backups, optional SMTP reminders, Windows notifications, and startup checks.
- Optional local password verification using salted `scrypt` hashes and password visibility control.
- Isolated development-only fictional demo data and code-driven public screenshot capture.
- English and Simplified Chinese documentation, contribution templates, private security reporting guidance, CI, and Dependabot configuration.

### Rebuilt architecture and behavior

- Rebuilt the application around TypeScript, Electron, React, and SQLite.
- Reworked the data model, billing logic, historical snapshots, archive behavior, UI, backup flow, reminder flow, security boundary, tests, documentation, and branding.

[1.0.0]: https://github.com/wx2529496539-arch/team-rental-desk/releases/tag/v1.0.0
