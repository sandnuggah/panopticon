# TODO

Kept by Claude at Adam's request. Newest items at the bottom of each section; done items are ticked
and cleared out now and then.

## UI update

- [x] Research UI libraries (pros and cons)
- [x] Choose a UI library — Konsta UI (iOS look), spiked on branch `konsta-spike`
- [x] Decide: auto iOS/Material, phone layout everywhere, drop the pet theme
- [x] Re-implement the UI with it (branch `konsta-spike`)
- [x] Map's bottom area: a bar with the Settings button, opening the Settings card (like Apple Maps' profile card). Tried and dropped: a tab bar
- [x] Settings and asset management moved into the Settings card; the /settings and /assets pages are gone
- [x] Asset pictures in the bottom bar: tap to centre, tap again for a details card
- [x] Appearance: map style, trail length, paw prints, snap to paths
- [x] Map controls: position button in the bar, zoom and Live as pills like the bar, credits in the Settings card
- [x] Share opens a second-level card, like Settings' pages
- [x] Merged to `main` and released as `:40` (2026-10-10)

## Trail on the map

- [ ] _(waiting for details)_

## Later / maybe

- [ ] Try Traccar's position filters for the ST-904L: `filter.maxSpeed` ≈ 27 (knots), `coordinates.filter` with `coordinates.minError` 15–25 m
- [ ] Email Mictrack: EU distributor or VAT-included shipping, MT710L CE approval date, and whether the MT710L uses the MT710's `tlt2h` protocol
- [ ] If an MT710 arrives: show "Home" instead of "No recent contact" while its home mode keeps it quiet
