# Architecture

## Runtime structure

- **Electron main process** owns window lifecycle, SQLite, backups, rate requests, SMTP, and native file selection.
- **React renderer** contains the operations overview, tables, forms, navigation, and settings UI.
- **Preload bridge** exposes a narrow typed API. The renderer cannot access Node.js directly.
- **SQLite** lives under Electron `userData`, runs in WAL mode, enforces foreign keys, and uses explicit transactions for multi-table writes.
- **Desktop platform adapter** owns native notifications, startup registration, Chrome profile discovery, and profile-pinned shortcut creation. The working implementation is under `src/main/platform/windows`; other platforms can replace this adapter without rewriting accounting rules.

## Security boundary

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`
- No application HTTP server or listening port.
- Renderer writes pass through explicit IPC handlers and Zod validation.
- Passwords and SMTP settings are read only by the main process.
- Local passwords use salted `scrypt`; plaintext passwords are never stored.

The password prompt prevents casual in-app access. It does not encrypt the SQLite file or replace Windows account and disk security.

## Data model and history

The main aggregates are spaces, mother accounts, child seats, billing cycles, receipts, renewal events, payment methods, currencies, shortcuts, reminder deliveries, and backup runs.

Important invariants:

- A space has at most two active child-seat positions.
- Archived child seats remain distinct records; a new customer never overwrites an archived customer.
- Active position uniqueness is enforced by a partial SQLite index.
- Billing cycles freeze the space, space name, position, customer, amount, and currency needed to display historical transactions.
- Receipt and renewal reversals retain audit rows and reject unsafe out-of-order operations.
- Operational deletion uses tombstones where history must survive.
- Currencies used only by history can be hidden while their decimal metadata remains readable.

## Backups

SQLite's online backup API creates a consistent copy without editing the source database. Before publication, each backup is opened independently and checked with `PRAGMA integrity_check` and `PRAGMA foreign_key_check`.

The completed folder contains the database, sanitized settings, verification metadata, and a restore guide. SMTP URLs are removed from the copied database and settings snapshot. Temporary folders are renamed only after verification succeeds.

## Rates and reminders

Enabled currency codes are requested from Coinbase, with Frankfurter as fallback. Cached real rates remain available when the network is down; the app never invents a USDT 1:1 fallback.

Space and child reminders have separate settings. Email is optional. Windows startup checks run as a short-lived `--startup-check` process and use the native notification center instead of a centered app dialog.

## Chrome shortcuts

The main process reads only Chrome's standard `Local State` profile index and confirms each listed profile directory still exists. The renderer receives profile labels and optional account hints through authenticated IPC. Shortcut creation validates the selected profile and an HTTP/HTTPS target, avoids overwriting existing `.lnk` files, and does not enable Chrome's missing-profile fallback to the default account.

The renderer-facing `TeamRentalApi` and `ChromeShortcutProvider` contracts do not depend on the Windows implementation. `app:bootstrap` reports platform capabilities so a completed community port can hide or replace unavailable controls instead of faking success.

## Development and preview isolation

Every ordinary unpackaged development run uses the sibling `team-rental-manager-development` user-data directory, seeds fictional records, and never opens the installed app's live database. Public screenshots use the same isolation rules with code-driven page selection, not simulated clicks. Two environment variables exist only for explicitly selecting an unpackaged preview:

- `TEAM_RENTAL_USER_DATA_DIR`
- `TEAM_RENTAL_PREVIEW_SECTION`

They must be supplied together, the data path must be absolute and non-overlapping with the normal user-data directory, and only approved screenshot pages are accepted. Packaged builds ignore both variables. Seeding refuses any preview database that already contains business records.

## Build and delivery

Electron Vite builds the main, preload, and renderer bundles. Electron Builder produces a Windows x64 NSIS installer while keeping the existing application ID and `%APPDATA%\team-rental-manager` directory for upgrade compatibility.

Generated bundles, installers, databases, backups, logs, and local state are excluded from Git. GitHub Actions performs installation, type checking, the complete test suite, and a production build on Windows, macOS, and Ubuntu. Only the Windows installer is an official release artifact.
