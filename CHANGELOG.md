# PCN PCR Calculator — Changelog

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
