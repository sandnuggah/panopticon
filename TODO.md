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

- [x] Steps 1 and 2: places as Traccar geofences: Settings → Places, an editor on the map (circle picker, size 50 m–2 km, which assets), places drawn on the map, "Home" instead of the address in the details card, arrivals and departures from Traccar's events, a banner when one happens while the app is open. Mock Traccar has geofences and events. Released as `:45` (2026-10-10)
- [ ] Try places on the real Traccar (`:49`): a Home for Betty, then check her arrivals and departures list (it needs reports allowed for the user) and the banner when she leaves
- [x] Step 3: alerts with Web Push: Settings → Alerts per phone (leaves/arrives at each place, tracker offline), Traccar's event forwarding to `/hooks/traccar-events`, choices sealed on the devices, VAPID key from SESSION_SECRET. Tested against the mock and Apple's push service with a made-up subscription; not yet on a real iPhone. Released as `:46` (2026-10-10)
- [ ] Try alerts on the real iPhone: copy the updated `deploy/compose.yaml` to the server (it now passes TRACCAR_EVENTS_SECRET; fixed after `:46`, pushed to GitHub), set TRACCAR_EVENTS_SECRET in `.env` and the three traccar.xml lines (README → Alerts), turn on in the Home Screen app, Send a test alert, then a real "Betty leaves Home". Needs panopticon on https at its real domain (Apple refuses other VAPID subjects)
- [ ] Research alerts on Android: Chrome's push goes through fcm.googleapis.com (allowed), but check Firefox and Samsung Internet's push services, whether the service worker shows the Declarative Web Push message there, whether the installed app is needed, and test on a real Android phone (or an emulator with Google Play services)
- [ ] Watch for false "left Home" at the edge of a place (ST-904L fixes wander 15–25 m); the position filters below would help

## Code

- [x] Clean-up after the UI rebuild: Prettier config and one formatting pass; Snap to paths and component renames; live link files named after live links; bottom bar split from the Settings card, icons in one file; the map in its own folder with the trail drawing split out; `useCardHistory` (fixed an extra history entry after the back gesture); live link pages with the same map buttons and credits, maplibre's controls removed; credits parser with tests; focus back to the asset's picture when its details card closes. Released as `:43` (2026-10-10)
- [x] Dynamic Type, checked in the iOS Simulator (iOS 18.5 and 27, default to the largest size): fixed spacing so only text grows, switches, icons and the asset page's navigation bar one size, wrapping tracker rows and long words, no focus ring on ✕, fixed card corners, Settings card as tall as its content, page colour behind Safari 26+'s bars. Released as `:44` (2026-10-10)
- [x] Bottom bar in two groups: your position and the assets in a bar as wide as they need, Settings as its own round button; 64 px tall with 48 px pictures; zoom buttons as wide as Settings and lined up with it. Released as `:47`; the assets scroll sideways with a fade at the edges when they don't fit, your position staying put, in `:48` (2026-10-10)

## Look and feel

- [ ] Make the sign-in page (the landing page) more exciting: today it's a plain title and two buttons
- [x] "Update available · Reload" at the top right of the map when a newer release is running: each build has an ID, the live stream sends the server's, a page from an older build shows the notice after its stream reconnects. Released as `:49` (2026-10-10); first visible on the deploy after that one

## Later / maybe

- [ ] Try Traccar's position filters for the ST-904L: `filter.maxSpeed` ≈ 27 (knots), `coordinates.filter` with `coordinates.minError` 15–25 m
- [ ] Email Mictrack: EU distributor or VAT-included shipping, MT710L CE approval date, and whether the MT710L uses the MT710's `tlt2h` protocol
- [ ] If an MT710 arrives: show its place (such as Home) instead of "No recent contact" while its home mode keeps it quiet
