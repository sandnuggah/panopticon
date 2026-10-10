# TODO

Kept by Claude at Adam's request. Newest items at the bottom of each section; done items are ticked
and cleared out now and then.

## Trail on the map

- [ ] Snap train and metro rides to the tracks. Today they're drawn through their GPS fixes (30 s apart, so curves are cut) and straight through tunnels and silences. Valhalla can't do rail; [OpenRailRouting](https://github.com/geofabrik/OpenRailRouting) (Geofabrik, GraphHopper-based, self-hosted, OSM rail incl. metro tunnels) can match fixes to tracks and route tunnel and silent legs between their ends. Trafiklab GTFS ruled out (needs a key, no track shapes found). Steps:
  1. Experiment: OpenRailRouting with a Stockholm + Sörmland extract; match Saturday 3 October's train and metro hop; before/after screenshots; measure RAM and build time
  2. If good: match ride legs with fixes, route underground and silent legs; only use a result that fits the fixes (as Snap to paths does); behind Snap to paths or a new "Snap rides to tracks" switch
  3. README: compose setup for the server, like Valhalla's
  - Risks: a prototype (pin a version); badly mapped rail in places; parallel tracks (commuter train and metro through central Stockholm) can get the wrong one

## Later / maybe

- [ ] Try Traccar's position filters for the ST-904L: `filter.maxSpeed` ≈ 27 (knots), `coordinates.filter` with `coordinates.minError` 15–25 m
- [ ] Email Mictrack: EU distributor or VAT-included shipping, MT710L CE approval date, and whether the MT710L uses the MT710's `tlt2h` protocol
- [ ] If an MT710 arrives: show "Home" instead of "No recent contact" while its home mode keeps it quiet
