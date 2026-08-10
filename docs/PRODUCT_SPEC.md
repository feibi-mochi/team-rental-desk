# Team Rental Desk product specification

## Positioning

Team Rental Desk is a single-user, local-first Windows operations tool for shared ChatGPT and Codex spaces. The app does not provide LAN, public-web, cloud-account, synchronization, or multi-user server features.

The official v1.0.0 release supports Windows 10/11 x64. The product UI remains Simplified Chinese; public repository documentation is available in English and Chinese.

## Core objects

- **Space:** service type, mother login, country, source cost and currency, billing cycle, renewal date, payment methods, and up to two active child positions.
- **Child seat:** rental or self-use, position, customer login, label, contact, joined date, charge, payment day, cycle, and collection state.
- **Payment method:** active or archived channel. A space can bind up to four and select one default.
- **Currency:** name, symbol, decimal places, enabled state, and USD quote. USD and CNY are protected accounting bases.
- **Shortcut:** either a generated Windows `.lnk` pinned to a detected standard Chrome profile and URL, or a user-selected local file or program; both may optionally link to a space.

## Chrome shortcut flow

- The shortcut page reads Chrome's standard local profile index and lists only profile directories that still exist.
- The user chooses a Chrome profile, display name, target HTTP/HTTPS URL, and optional space binding.
- The app creates a non-overwriting `.lnk` in the current desktop's `ChatGPT` folder and stores the binding locally.
- A generated shortcut never uses Chrome's fallback-to-default-profile switch. If the original profile is removed, it cannot silently open a different signed-in account.
- The app reads no passwords, verification codes, cookies, or service credentials. Expired sessions still require normal Chrome sign-in.

## Payments and renewals

- Receipts preserve gross amount, 0% / 0.6% / 1.6% fee, net amount, actual timestamp, currency, and frozen USD/CNY values.
- Partial payments are supported; overpayment is rejected.
- A new rental customer begins with an initial billing cycle. Fully collecting that cycle does not incorrectly advance an extra month.
- Normal renewal cycles advance by calendar month with end-of-month clamping.
- Space renewals require the final USD cost shown by the provider and freeze its CNY value at the current real quote.
- Historical transactions remain assigned to their original space and position even if a child seat is restored elsewhere.
- Reversals are ordered, auditable, and retain the original record plus a reason.

## Operations overview

The overview shows monthly receivables, current-month gross and net income, lifetime net income, monthly cost, projected profit, child and mother expiry counts, cost coverage, upcoming work, monthly income, and per-space performance.

Upcoming work links directly to the relevant space, shortcut, receipt, or renewal action.

## Archive and operational deletion

- Spaces and independently archived child seats have separate navigation pages.
- Restoring a child seat rechecks target-space availability, position, currency, and unresolved partial cycles inside a transaction.
- A child archived independently does not accidentally return when its former space is restored.
- Operational deletion hides an archived object but preserves accounting history.
- Historical receipts and renewals are never silently cascade-deleted by the user interface.

## Currencies and rates

- Users can add, edit, enable, disable, and safely remove non-base currencies.
- Active business objects block removal of a currency they still use.
- Removed currencies remain available as historical metadata so zero-decimal and other formats do not change.
- Coinbase is the primary public rate source, with Frankfurter as fallback and verified local cache when offline.
- A missing stablecoin quote is shown as missing; no synthetic 1:1 rate is invented.

## Reminders

- Windows login startup check, native notifications, and scheduled SMTP email are optional.
- Space and child settings are independent.
- A user can control thresholds, schedule time, repeat-on-the-same-day behavior, recipient, sender, SMTP URL, and templates.
- After the daily send time, the scheduler reruns only when the set of due item IDs changes, so an item added later that day is not missed and an unchanged list is not sent every 30 seconds.
- Archived or operationally deleted records do not create reminders.

## Backups

- Manual, on-close, and interval backups are independent options.
- Backup paths must be absolute and outside both the installation directory and active data directory.
- Every backup uses SQLite's online backup, strips SMTP URLs from the copy, validates integrity and foreign keys, and publishes only after success.
- Retention is configurable from 3 to 100 completed managed backups.

## Local security

- First use asks for a non-empty password; there is no fixed default and no character-count restriction.
- Password fields include an eye control to show or hide input.
- The password is stored as a salted `scrypt` hash.
- Password verification at startup can be disabled on a personal computer.
- Five failures within five minutes cause a 30-second local lockout.
- There is no MFA because the product has no remote account or server.

## Privacy and release

- No telemetry, advertising, crash reporting, automatic updater, or paid feature gate.
- Public screenshots use only fictional `example.com` data in an isolated development database.
- Repository rules exclude databases, backups, SMTP credentials, local paths, build output, logs, and local state.
- Exchange-rate and optional SMTP traffic are documented explicitly.
- The code and ordinary documentation use Apache-2.0; reserved brand/payment assets are identified separately.
