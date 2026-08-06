# PCN PCR Calculator — Changelog

## Ver 2.14 — 2026-08-05
- Admin upload tool (`pcr-admin.html`): WEF date field now takes ISO format
  (`YYYY-MM-DD`) directly, matching the rest of the app — no more DDMmmYY
  conversion.
- Admin backend: updates that don't actually change a runway's active PCN
  are now skipped (deduplication) instead of writing a redundant version.
- Admin result display now shows which ICAO codes changed, split into
  Current Cycle (WEF today or earlier) vs Next Cycle (future WEF), plus
  Skipped (no-op) and Rejected (bad ICAO/PCN format) breakdowns.
- Admin page now keeps a running log of every submission for the active WEF
  cycle instead of overwriting it on each submit — stored server-side
  (`pcr-api`'s `/log` endpoint) so the history is the same no matter which
  browser or device the admin uses. The log resets automatically when a new
  WEF date is submitted.
- Check tab: sync status text simplified to just show the live data's WEF
  date (`Synced data: Live (YYYY-MM-DD)`) — dropped the "→ Scheduled" note
  about the next pending cycle, since it added noise without being
  actionable for regular users.

## Ver 2.13 — 2026-07-31
- Live PCN/PCR runway updates: new tiny backend (pcr-api) lets updated
  runway pavement numbers be pushed out without a full app redeploy.
- New **"Get PCN/PCR Updates" button** on the Check tab — fetches the latest
  overrides and applies them to the displayed runway table (with a small
  "updated" badge + timestamp on affected rows). Auto-syncs once on page
  load too; degrades gracefully (silently) if the API is unreachable, e.g.
  the standalone pcr-all.html build.
- New **admin-only upload tool** (`pcr-admin.html`) — not linked from the
  main app or its navigation, reachable only by direct URL. Supports a
  single-row form and a bulk paste (ICAO,RWY,PCN per line). All writes
  require a shared passcode; the read side (Check tab) stays open, matching
  the app's no-login design — only the write path is gated, since it can
  affect real pavement/weight decisions.

## Ver 2.12 — 2026-07-31
- **Management decision: APS weight is no longer used anywhere in the calculation.**
  Both the Calculator and PCN/PCR Check tabs now use Boeing's own published
  minimum weight per type (Boeing ACAP, D6-58329-2 §7.10/7.11) — the two
  published table points (max taxi weight, min weight) are used as-is, with
  no per-tail substitution/extrapolation beyond them.
- Calculator tab: "Aircraft registration" reverted to "Aircraft Type" (757-200 /
  767-300ER / 777F) — since APS no longer differentiates tails, per-registration
  selection no longer changes the result and was removed to avoid implying
  precision that doesn't exist.
- Check tab: the three per-type registration pickers (B757/B767/B777 aircraft)
  removed for the same reason; each type now always uses its Boeing ACAP
  minimum weight.
- Downloadable settings workbook (Excel) removed from the app — the "Download
  settings workbook" links and the hosted file are gone; settings_xlsx.py
  removed from the repo.

## Ver 2.11 — 2026-07-16
- PCN/PCR Check tab now available on mobile/tablet too (desktop-only restriction
  removed); controls stack on narrow screens, runway table scrolls horizontally
- Settings workbook: Calculator sheet removed; README simplified (helpdesk contact)

## Ver 2.10 — 2026-07-10
- Calculator summary label now follows the selected system: "ACN range" for PCN,
  "ACR range" for PCR

## Ver 2.9 — 2026-07-10
- Fix: switching MTW/MLW on the Check tab crashed the calculator state
  ("type[calcSystem] is undefined") — the PCR/PCN toggle handler was bound to
  all segmented buttons instead of only its own

## Ver 2.8 — 2026-07-10
- Airfield search: custom styled suggestion dropdown (replaces native datalist,
  which rendered illegibly under some browser/OS themes); arrow-key + Enter
  navigation, click to select, up to 12 matches by ICAO/IATA/name
- Form controls forced to light color-scheme for consistency

## Ver 2.7 — 2026-07-10
- Error banner no longer shows masked "Script error. (line 0)" noise from browser
  extensions; only genuine app errors (with message + line) are displayed

## Ver 2.6 — 2026-07-10
- Master settings workbook (PCN_PCR_Settings.xlsx) downloadable from the app footer
- Workbook is the standard way to update fleet / chart data / ref weights / airfields

## Ver 2.5 — 2026-07-10
- Version number now displayed in the top panel; formal version control starts here
- Official ready-made DHL "PCN PCR Calculator" logo (topbar + PWA/home-screen icons)
- Renamed to "PCN PCR Calculator", topbar title in DHL red

## Earlier (pre-versioning), 2026-07-09 to 07-10
- Full overhaul in DRM design language (DHL yellow topbar, cards, KPI results)
- Fleet-based calculator: 20 registrations with per-tail min weights, live two-way calc + verdict
- Desktop-only "PCN/PCR Check" tab: per-airfield runway check vs MTW/MLW, 455 airfields embedded
- PWA fixed (registered SW, network-first versioned cache); build_single.py for standalone pcr-all.html
