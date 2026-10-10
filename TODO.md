# TODO

Kept by Claude at Adam's request. Newest items at the bottom of each section; done items are ticked
and cleared out now and then.

## Trail on the map

- [ ] Snap train and metro rides to the tracks. Today they're drawn through their GPS fixes (30 s apart, so curves are cut) and straight through tunnels and silences. Valhalla can't do rail; [OpenRailRouting](https://github.com/geofabrik/OpenRailRouting) (Geofabrik, GraphHopper-based, self-hosted, OSM rail incl. metro tunnels) can match fixes to tracks and route tunnel and silent legs between their ends. Trafiklab GTFS ruled out (needs a key, no track shapes found). Steps:
  1. Experiment: OpenRailRouting with a Stockholm + Sörmland extract; match Saturday 3 October's train and metro hop; before/after screenshots; measure RAM and build time
  2. If good: match ride legs with fixes, route underground and silent legs; only use a result that fits the fixes (as Snap to paths does); behind Snap to paths or a new "Snap rides to tracks" switch
  3. README: compose setup for the server, like Valhalla's
  - Risks: a prototype (pin a version); badly mapped rail in places; parallel tracks (commuter train and metro through central Stockholm) can get the wrong one

## Places and alerts

- [x] Steps 1 and 2: places as Traccar geofences: Settings → Places, an editor on the map (circle picker, size 50 m–2 km, which assets), places drawn on the map, "Home" instead of the address in the details card, arrivals and departures from Traccar's events, a banner when one happens while the app is open. Mock Traccar has geofences and events. Released as `:45`; place names as solid indigo pills (14 px, no blurry halo) in `:57` (2026-10-10)
- [ ] Try places on the real Traccar (`:60`): a Home for Betty, then check her arrivals and departures list (it needs reports allowed for the user) and the banner when she leaves
- [x] Step 3: alerts with Web Push: Settings → Alerts per phone (leaves/arrives at each place, tracker offline), Traccar's event forwarding to `/hooks/traccar-events`, choices sealed on the devices, VAPID key from SESSION_SECRET. Tested against the mock and Apple's push service with a made-up subscription; not yet on a real iPhone. Released as `:46` (2026-10-10); wording says "device" rather than "phone" (alerts work in desktop browsers too) in `:58` (2026-10-11)
- [ ] Try alerts on the real iPhone: the test alert works (2026-10-11). The offline alert didn't fire: Traccar only records offline events with `event.status.enable`, off by default since 6.14 (now in README → Alerts). Add `<entry key='event.status.enable'>true</entry>` to traccar.xml, restart Traccar, then let the tracker go quiet (allow `status.timeout`, 10 min by default, and the 30 min quiet period between offline alerts). Then a real "Betty leaves Home"
- [ ] Research alerts on Android: Chrome's push goes through fcm.googleapis.com (allowed), but check Firefox and Samsung Internet's push services, whether the service worker shows the Declarative Web Push message there, whether the installed app is needed, and test on a real Android phone (or an emulator with Google Play services)
- [ ] Watch for false "left Home" at the edge of a place (ST-904L fixes wander 15–25 m); the position filters below would help

## Code

- [x] Clean-up after the UI rebuild: Prettier config and one formatting pass; Snap to paths and component renames; live link files named after live links; bottom bar split from the Settings card, icons in one file; the map in its own folder with the trail drawing split out; `useCardHistory` (fixed an extra history entry after the back gesture); live link pages with the same map buttons and credits, maplibre's controls removed; credits parser with tests; focus back to the asset's picture when its details card closes. Released as `:43` (2026-10-10)
- [x] Dynamic Type, checked in the iOS Simulator (iOS 18.5 and 27, default to the largest size): fixed spacing so only text grows, switches, icons and the asset page's navigation bar one size, wrapping tracker rows and long words, no focus ring on ✕, fixed card corners, Settings card as tall as its content, page colour behind Safari 26+'s bars. Released as `:44` (2026-10-10)
- [x] Bottom bar in two groups: your position and the assets in a bar as wide as they need, Settings as its own round button; 64 px tall with 48 px pictures; zoom buttons as wide as Settings and lined up with it. Released as `:47`; the assets scroll sideways with a fade at the edges when they don't fit, your position staying put, in `:48`; spread across the window on wide screens (1024 px and up) in `:56` (2026-10-10)

## Look and feel

- [x] A front page (`/welcome`) with a playful paper-map scene (a dog, a briefcase and a bike as paper cutouts, RAL colours, day and night maps), the title as a paper cutout, and the main features; sign-in on its own page (`/login`); `SIGN_IN_METHODS` (sso, password or both). Released as `:50`; features as a trail of stops on post-it notes in `:51`; cutouts black in production (CSP blocked inline styles) fixed, and a "What is Panopticon?" link on the sign-in page, in `:52`; "or deploy it yourself" (GitHub) under Sign in, in `:53`; a "What it looks like" screenshot gallery (light and dark, from the mock Traccar) in `:54`; a wide-screen layout (side-by-side header, zig-zag trail, all screenshots in a row) in `:55` (2026-10-10)
- [x] Fixed: with the Auto map style, switching the phone between light and dark crashed the map screen (recolouring while the other style loaded). Released as `:54` (2026-10-10)
- [ ] Retake the front page's screenshots when the UI changes (iOS Simulator, mock Traccar with MAP_MATCHING_URL for Snap to paths; status bar shows 9:41 while the arrivals list shows evening times)
- [x] On wide screens, the cards are side panels (like Apple Maps' sidebar on a Mac): an asset's details and Share on the left, Settings, its pages and the place editor on the right; the place picker's circle centres in the map beside the editor. Released as `:60` (2026-10-11)
- [x] A new app icon: a folded paper map with a red paper-cutout pin on the app's green (front page style, RAL colours); source in dev/icon-full.svg. Released as `:59` (2026-10-11)
- [ ] Re-add Panopticon to the iPhone's Home Screen to get the new icon (iOS keeps the old one)
- [x] "Update available · Reload" at the top right of the map when a newer release is running: each build has an ID, the live stream sends the server's, a page from an older build shows the notice after its stream reconnects. Released as `:49` (2026-10-10); first visible when `:50` is deployed

## Later / maybe

- [ ] Try Traccar's position filters for the ST-904L: `filter.maxSpeed` ≈ 27 (knots), `coordinates.filter` with `coordinates.minError` 15–25 m
- [ ] Email Mictrack: EU distributor or VAT-included shipping, MT710L CE approval date, and whether the MT710L uses the MT710's `tlt2h` protocol
- [ ] If an MT710 arrives: show its place (such as Home) instead of "No recent contact" while its home mode keeps it quiet
