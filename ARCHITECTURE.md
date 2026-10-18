# panopticon architecture

Phone-friendly web UI for a self-hosted Traccar server, tracking a handful (1–5) of assets: anything with a tracker on it, such as a pet.
Replaces Traccar's own UI for daily use; Traccar's UI stays available for admin work.

- **Must:** SSO and password sign-in, live map, last-seen time, battery level (when the tracker reports it, see [Battery](#battery)).
- **Also:** add, rename and remove assets and change their photos (see [Managing assets](#managing-assets)), so everyday changes don't need Traccar's UI.
- **Won't:** user management, reports, multi-vehicle features.
- **Rules:** no secrets in git, no external analytics, minimal dependencies.
- **Done when:** you can sign in to your Traccar server and see your assets on a map.

Target: Traccar `:latest`, which is **v6.15.3** (released 2026-08-26). Every Traccar behavior below was checked against that version's source.

## Overview

The TanStack Start server sits between the browser and Traccar. The browser only talks to the app's own origin; only the server talks to Traccar. The Traccar URL and user tokens never reach the browser, there's no CORS setup, and the only Traccar endpoints reachable through the app are the few listed here.

```
phone                          TanStack Start server               Traccar
map + asset list ── server fn ──▶ login / logout / getAssets ──REST──▶ /api/*
EventSource      ◀──── SSE ───── /live relay             ◀── WS ──── /api/socket?token=
SSO button       ──────────────▶ /auth/sso, OIDC callback ──────────▶ OpenID
email links      ──────────────▶ catch-all 302 ────────────────────▶ Traccar UI
```

## Authentication

Every sign-in path ends the same way:

1. Get a Traccar session.
2. Exchange it for a Traccar API token: `POST /api/session/token` with `expiration` = now + `SESSION_DAYS` (ISO 8601).
3. End the Traccar session (`DELETE /api/session`).
4. Store the token in the app's session cookie: sealed (encrypted), `HttpOnly`, `Secure`, `SameSite=Lax`, using TanStack Start's built-in `useSession`.

After that, REST calls use `Authorization: Bearer <token>` and the WebSocket uses `?token=<token>`. A token survives Traccar restarts, has a fixed expiry, and is revoked on logout (`POST /api/session/token/revoke`). When it expires, you sign in again.

The app is stateless: the only state is the cookie.

### Which methods

`SIGN_IN_METHODS` chooses them: `sso`, `password`, or both (`sso,password`, the default). The sign-in page offers only those (`getLoginOptions`): SSO only when Traccar has OpenID set up, and the password form not when Traccar forces OpenID (it refuses passwords then). The server enforces it too: a password sign-in gets `turned-off`, and `/auth/sso` and its callback send the browser back to the sign-in page, when that method isn't allowed. With SSO as the only method and Traccar unable to do it (OpenID off, or Traccar unreachable), the page says single sign-on isn't available right now.

### Password

A server function sends `POST /api/session` with `email` and `password` (form-encoded). If Traccar replies `401` with `WWW-Authenticate: TOTP`, the form asks for the 2FA code and retries with `code`.

Admins sign in with a password as usual, both here and in Traccar's own UI, **as long as `openid.force` stays off**. When it's on, Traccar rejects every password login, admins included (`LoginService.login(email, password, code)` returns null immediately).

### SSO (OpenID Connect via Traccar)

This reuses the OpenID setup already configured in Traccar, so the identity provider stays configured in one place.

1. `GET /auth/sso` fetches Traccar's `/api/session/openid/auth` with `redirect: 'manual'`. It saves the `state` from the returned identity-provider URL in a short-lived sealed cookie, then 302s the browser to the identity provider.
2. The identity provider returns to `GET /api/session/openid/callback` **on this app**. That path is fixed, because Traccar builds its redirect URI as `web.url + /api/session/openid/callback`. The app:
   - rejects the request if `state` doesn't match the saved one (Traccar sends a `state` but never checks it). The saved state is cleared on first use, so a callback URL can't be replayed;
   - forwards the query string to Traccar's callback, minus any `redirect_uri` (Traccar treats that as a Traccar Manager app override);
   - takes the `JSESSIONID` from Traccar's 303, reads the user (`GET /api/session`) and runs the token exchange above;
   - redirects to `/`.

The login page reads the public `GET /api/server` endpoint and shows "Sign in with SSO" when `openIdEnabled` is true. The password form is always shown.

When Traccar refuses a sign-in it answers 400 with the Java exception as the body. The app logs it and sends the browser to `/login?error=…`, where it shows one of:
- **`sso-no-account`:** no Traccar account has that email (`Registration disabled`).
- **`sso-not-allowed`:** blocked by `openid.allowGroup`.
- **`sso-unavailable`:** Traccar unreachable, or SSO not configured.
- **`sso-failed`:** anything else, including a state mismatch.

Tested end to end against a fake Traccar and identity provider, and confirmed with Pocket ID on the real server.

### Traccar config changes

```xml
<entry key='web.url'>https://panopticon.example.com</entry>
<!-- openid.force must be absent or false, or password login stops working -->
```

In your identity provider, add `https://panopticon.example.com/api/session/openid/callback` to the client's callback URLs. Pocket ID allows several, so keep Traccar's own while switching over.

**Traccar 6.15.3 quirks found while setting up Pocket ID:**
- `openid.clientId` is the ID the provider generated (a UUID in Pocket ID), not the client's display name.
- Traccar only requests the `groups` scope when `openid.adminGroup` is set. So `openid.allowGroup` on its own always fails with "Your OpenID Groups do not permit access". Recommended: set neither. With registration off, only emails that already have a Traccar account can sign in.
- With `openid.adminGroup` set, every SSO sign-in rewrites the account's admin flag from group membership, so an admin outside that group loses admin rights.
- Every SSO sign-in overwrites the Traccar display name with the provider's.
- Traccar doesn't send PKCE, so the provider must not require it for this client.

Consequences of pointing `web.url` at this app:

- **SSO in Traccar's own UI stops working.** Password login there is unaffected.
- **Traccar's emails build their links from `web.url`.** These are `/event/:id`, `/settings/notifications?token=…`, `/reset-password?passwordReset=…`, report links and `/api/media/…`. The app's catch-all route (`$.ts`) sends exactly those path prefixes (`/event/`, `/settings/`, `/reset-password`, `/reports/`, `/api/media/`) on to `TRACCAR_URL` with the same path and query, so email links keep opening Traccar's UI. Every other unknown path is a normal 404, so typos don't reveal Traccar's address. The redirect is built by string concatenation, so a path like `//evil.example` can't leave Traccar's host; Start also normalises such paths first.

### Session protection

- Protected routes check the session in `beforeLoad` and redirect to `/login`.
- **When a stored token counts as dead:** Traccar answers 401 for expired or revoked tokens. For tokens it can't verify at all (issued by another Traccar, or before its signing key changed) it answers **400 or 500**, even on public endpoints. So after any failed call, `tokenWasRejected` treats the token as dead if the call was a 401, or if `/api/server` fails with the token but works without it. A dead token clears the session and sends you to `/login`; other failures stay errors. (Found on the real server: a token from the fake Traccar produced an error page instead of the sign-in page.)
- Server functions are POST-only and the cookie is `SameSite=Lax`, which protects against cross-site request forgery.
- Server-side calls to Traccar send no `Origin` header, which Traccar's session origin check accepts.

## Live data

- **First load:** the `/` route loader calls `getAssets()`, which calls `GET /api/devices` and `GET /api/positions` (latest position per device). They are merged into a view model; the browser never gets raw Traccar objects:
  ```ts
  type Asset = {
    id: number; name: string; status: 'online' | 'offline' | 'unknown'
    lastUpdate: string | null   // last contact from the tracker
    location: { lat: number; lon: number; accuracy?: number; fixTime: string } | null  // null until the first fix
    battery?: { percent?: number; volts?: number }
    placeIds: number[]          // the places its latest position is inside (see Places)
  }
  ```
  Devices disabled in Traccar are left out.
- **Updates:** the `/live` server route opens a WebSocket to `TRACCAR_URL/api/socket?token=…` using Node's built-in WebSocket client. It turns Traccar's `devices` and `positions` messages into `LiveUpdate`s (`src/lib/live.ts`) and sends them to the browser as Server-Sent Events. Events, logs and Traccar's `{}` keepalives are dropped. Traccar sends the latest positions as soon as the socket connects.
  - Why SSE: it's plain HTTP (the Start server needs no WebSocket support), `EventSource` reconnects on its own, and the token stays on the server.
  - The stream sends a comment line every 25 s so proxies don't close it, and `retry: 5000` for reconnects. It also sends `X-Accel-Buffering: no` so nginx-style proxies don't buffer it.
  - When the browser disconnects, the upstream socket is closed too.
- **Applying updates** (`applyUpdates`): device updates change name, status and last contact. Position updates never move an asset backwards in time, and a position without battery keeps the last known value. A position whose places differ from the asset's last ones means arrivals and departures (see [Places](#places)), which the hook reports to the page. An update for an unknown asset (added in Traccar) reloads the list; a disabled one is removed.
- **When things go wrong:**
  - The stream ends (Traccar closed the socket): the browser reconnects after 5 s, then reloads the list and trail history to fill the gap.
  - The stream is refused: `/live` can't tell from the socket why, so it checks the token with a REST call. If the token is dead it clears the session and returns 401, and the page goes to `/login`. Otherwise it returns 502; the page keeps what it has, shows "Offline, retrying" and retries with backoff (5 s doubling to 60 s).
- **Phones:** background tabs get suspended, so when the page becomes visible again it reloads the list and trail history and reopens the stream.
- **Live indicator:** "Live", "Connecting…" or "Offline, retrying", as a pill floating over the map's top-left corner, so a still map isn't mistaken for a still asset.
- **Update available:** each build has an ID (`lib/buildId.ts`, set by Vite in `vite.config.ts`: the build's time, made once per build process so the server and browser code of one build share it; `dev` on the dev server). Every live stream starts with an `event: version` carrying the server's. A page from an older build hears a different one when its stream reconnects after a new release is deployed (a restart drops the stream), and shows **Update available · Reload** at the top right of the map, level with the Live indicator (`UpdateNotice.tsx`); tapping it reloads the page. That matters most for the Home Screen app, which otherwise keeps running the version it opened with, and whose old code can't call a newer server's functions.
- **Scale:** one upstream socket per open tab. At 1–5 assets and a handful of users that's fine.

## Trail

A trail behind each asset showing where it went in the last N minutes, drawn by what it was doing: walking, staying put, riding a vehicle, or travelling underground. Older parts fade.

- **History:** `getTrails({ minutes, assetIds })` calls `GET /api/positions?deviceId&from&to` once per asset. It always covers at least 3 hours, even with the trail off, so the card can say what the asset is doing right now and how long it's been in one place; only the chosen length is drawn. Three hours of reports every 30 s is about 360 points per asset.
  - Reports **without a GPS fix** are kept, marked `valid: false`. Their position is stale, so they're never drawn; they only count as evidence of travel without GPS.
  - Each point also carries the **serving cell tower**: Traccar's `network.cellTowers` when it has one, otherwise `io4` for SinoTrack's `h02` (see [Battery](#battery) for the io fields).
  - Traccar refuses this endpoint for users with "disable reports" set. Those users just get no trail and no activity.
- **Live:** every live position, with or without a fix, is appended; points older than the window are dropped.

### What the asset was doing (`src/lib/segments.ts`)

The trail is split using only the tracker's own reports: speed between fixes, gaps without a fix, and cell changes. It needs no map data, so it works in any city or country. The thresholds were tuned on a real ST-904L trip by metro across Stockholm (Skanstull → Slussen → Östermalmstorg → Karlaplan → Ropsten), and checked against five hours at daycare with GPS gaps and up to 100 m of jitter, which stayed "walking". A weekend in October added car rides in the country and in town, a train at up to 178 km/h into Stockholm ending in the tunnel under the city, a metro hop, and the tracker's long silences while asleep.

| Piece | Rule |
|---|---|
| **Vehicle** | Averaging over 20 km/h between two fixes, over at least 150 m. A dog doesn't do that on foot for 30 s; GPS jitter doesn't cover 150 m. |
| **Underground** | A vehicle hop with reports without a fix in between, or a GPS gap that ends at least 300 m away at over 10 km/h, both only while the tracker kept reporting. |
| **Station stop, traffic** | A pause of at most 2 minutes between two rides belongs to the ride when it's within 100 m (a station) or averages at least 10 km/h (slower driving in traffic, or the extra report the tracker sends a few seconds after a regular one, which is a hop under 150 m even at 178 km/h). Longer stops (changing lines) don't. |
| **Ride ends** | Hops of at least 10 km/h and 30 m next to a ride belong to it: setting off and arriving, a driveway. The 30 m leaves out the jitter of reports a second apart. |
| **Silence** | No report at all for over 10 minutes (the tracker sleeps when still) is never evidence of being underground. If the next fix is within 40 m it's the same place (a stay); farther and at least 20 km/h, a ride; farther and slower, nothing is drawn between them. |
| **Stay** | At least 2 minutes within 40 m of where it started; after that it goes on while new fixes are within 40 m of the middle of those first fixes (kept as it is, so it doesn't follow a slow walk away), so arriving from the street and then wandering indoors stays one stay. Drawn as a dot (see Drawing). Pottering about one place makes many small stays, so for "Here since" two stays become one **place** when their circles are at most 25 m apart and the move between them never went more than 50 m outside them. This repeats until nothing joins, and a move that never left a neighbouring stay's circle joins it too. A morning at daycare is then one circle instead of four overlapping ones with lines between them, while a walk around the block and back stays a walk. |
| **Spike** | A lone fix at least 40 m from the fixes either side of it, all within 3 minutes, while those two are at most 0.6 of the way through it apart, went out and straight back: GPS jumping among buildings or trees. It's left out before anything else. Seen on a real walk in October 2026, from a tracker reporting every minute or two: one fix 70 m out on a street beside the park the walk went through, and a zigzag of fixes 80–90 m apart, seconds apart. A corner keeps its fix (a right angle is 0.71). |
| **Move** | Everything else: walking. |

- **Right now** (`currentActivity`), for the card:
  - **Moving underground** before GPS returns: at least a minute of reports without a fix while served by at least 3 different cell sites. LTE cell IDs are site × 256 + antenna, so the antennas of one mast count once; indoors the tracker loses its fix but stays on one mast.
  - **In a vehicle / Moving underground** after a ride, until 2 minutes after it ended, so station stops don't flicker.
  - Nothing when the latest report is over 3 minutes old.
  - Replayed against the real trip, the card switched on with the first train hop, and to "Moving underground" 90 s after GPS dropped.
- **Limits:** a bus, a car and an above-ground train all read as "vehicle". A car in a road tunnel (Norra länken) reads as "underground", which is literally true. Telling subway from train or tram would need stop locations from OpenStreetMap for a configurable area; not built.
- **Tests:** `npm test` runs `segments.test.ts` with Node's own test runner (Node 24 runs TypeScript directly). The data is a made-up trip in the same shape; real location data never goes in the repo.

### Snap to paths (map matching)

Optional: with `MAP_MATCHING_URL` set, the Appearance page offers **Snap to paths** (on by default, per browser; a browser only stores what was chosen there, and a choice stored before 2026-10-14, when every setting was stored whether chosen or not, is ignored; greyed out without the server). Walks are then drawn along the streets and paths they most likely took, instead of straight lines between GPS fixes. Rides and stays are unchanged.

- **Engine:** [Valhalla](https://github.com/valhalla/valhalla), self-hosted next to Traccar (see README.md), built from an OpenStreetMap extract. `trace_route` with pedestrian costing, so footpaths and parks count. Only panopticon's server talks to it; trail points never go to a third party, and the browser and CSP are unchanged.
- **Which walks** (`src/lib/matching.ts`, in the browser): `move` pieces from the classifier (as the map draws them, `showWandering`) that get at least 75 m from where they started at some point, so out and back counts (wandering around a yard never qualifies), with standing-still jitter (points within 15 m of the previous) dropped, and at least 3 points left. A walk from or to a stay starts or ends at the stay's middle, where the map draws it from: leaving home then follows the street from the door, instead of a straight line to the first fix outside, which only comes once the tracker has woken up and found itself.
- **Snapping** (`matchWalks` → `matching.server.ts`, `snapAlong` in `lib/snap.ts` with tests): at most 20 walks of 400 points per request, signed-in users only. Valhalla matches the whole walk (GPS accuracy 25 m, search radius 60 m: a dog's tracker is often 20–30 m off). Where the trace breaks, Valhalla answers with several trips, the first in `trip` and the rest in `alternates`, each saying which points it covers; all of them, in order, are the line. (Using only `trip` lost most of a real 465 m walk, which was then drawn as straight lines.) The line is kept only along the stretches where at least 3 fixes in a row lie within 20 m of it, and the walk is drawn as recorded in between, such as a dog running about on the grass. Fixes are matched to the line in order, so a walk out and back along one path takes each way in turn. Between two fixes in a row the line is followed only while it's at most 1.5 times as long as the way between the fixes plus 20 m; longer, it went somewhere no fix was (out to a street and back, round a block), and the two fixes' feet are joined straight instead. On a real afternoon of dog walks in October 2026 that cut 214 m of such detours from one walk. A walk with no such stretch is drawn as recorded. (Before, a walk was snapped whole or not at all: on average within 15 m and 90% within 30 m, so a run on the grass left the whole walk as straight lines.)
- **Parks:** inside a park a dog runs about on the grass, often within 20 m of a path it isn't on. So there a fix counts as on the path only within 8 m, and a stretch with a fix in a park needs 5 in a row. The parks come from the map's own vector tiles (OpenMapTiles' `landcover` layer with subclass `park`, where city parks are, and its `park` layer, which has only nature reserves and national parks), read from the tiles in view once the map has loaded and after each move (`parksInView` in `AssetMap.tsx`, `lib/parks.ts` with tests), so nothing extra is fetched. Walks wait for them, and the browser marks each fix in a park (`park: true`) when it asks for the snapping.
- **Caching:** the server keeps 500 results in memory; the browser keeps results per walk (first fix, last fix, point count), so a walk that grows gets re-snapped, debounced by a second.
- **Failures:** if Valhalla is unreachable or slow (5 s), walks are drawn as recorded and the server logs why; nothing is cached, so it's tried again.
- **Measured on the experiment:** a Stockholm extract built in seconds and used ~190 MB of RAM; a match takes ~3 ms. The real Stockholm walks snapped with an average deviation of 7–8 m.

### Drawing

- **Walking:** a 4 px line in `--trail`, in pieces of 3 hops so it can fade with age.
- **The latest outing in front:** from the end of the last stay of at least 20 minutes (home, daycare) before the latest movement (`latestOutingStart`, with tests); being in such a stay right now ends that outing rather than starting a new one. It's drawn from opacity 0.55 at its start to 0.95 at its newest point, and everything older from 0.12 to 0.25, so a long trail reads as this outing with the earlier ones as faint background.
- **Paw prints** (Appearance → Paw prints, per browser): walking as a dog's tracks instead of the line, a left and a right print 44 px apart along the walk, turned the way it went (a symbol layer with `symbol-placement: line` and an image drawn on a canvas in `--trail`, so there's no image file). Its own source holds each walk as one piece: in 3-hop pieces most would be too short for a print.
- **Rides:** through their fixes, in legs: dashed with GPS, dotted without (underground), and straight across stretches without fixes, since where exactly it went there isn't known. A ride is called a vehicle or underground ride by what it was for most of its time, so a train that ends in a tunnel is a vehicle ride with a dotted end, and a metro ride with stations in the open is underground.
- **Stays:** stops shorter than 5 minutes are part of the walk on the map (a dog stopping to sniff), so a walk is one path, snapped as one, instead of pieces between dots (`joinShortStops`, with `showWandering`; tried on a real dog walk: 6 pieces became 2 walks). Longer stays are a dot with a white ring (like a location dot's: the map style can be light or dark whatever the device's mode), 5 px across for a short stop up to 9 px for an hour or more, and the walks run through it, so the trail reads as one path. Stays within 40 m of each other share a dot, whenever they were (back at the same place later in the day, home on two days): it's at the longest of them, sized by their time together and faded by the latest (`stayDots`). The map doesn't join a place's stops, so the walking about it (a park) shows: it draws them as their own dots with lines between, and only joins two stops across a blip of a fix or two when they're at the same spot (`classifyTrail` with `showWandering`; Snap to paths uses the same pieces). This is only for drawing: the trail keeps each visit, so "Here since" is the current one. Stays used to be circles as big as the spread of their fixes, which indoors (wandering fixes) grew far bigger than the place itself and covered the map.
- All of it is one GeoJSON source with a `kind` property and a layer per kind, plus the paw prints' source.
- **Length:** set in the Settings card's Appearance → Trail: Off, 1 hour (default), 6, 12 or 24 hours, or **Today**, everything since local midnight. It loads a day of history and draws from midnight, so just after midnight it shows almost nothing.
  - An hour costs nothing extra, since 3 hours of history is always loaded. Longer means more per asset on each load: a day of reports every 30 s is about 2,900 points per asset.
  - Saved in the browser as `trail`. A saved length that's no longer offered moves to the closest one by ratio (anything up to 2 hours becomes 1 hour, never Off; 3 hours becomes 6); `trailMinutes`, the older name, is still read.

## Addresses

The selected asset's card shows its street address, e.g. "Storviltsgatan 5, Stockholm".

- **Source:** Traccar's own reverse geocoder (`GET /api/server/geocode`), so the provider, language and format are Traccar settings (`geocoder.*` in `traccar.xml`), not panopticon's. panopticon has no geocoding config of its own.
- **Provider:** recent Traccar versions have geocoding on by default, through LocationIQ with a key shared by every install. That sends coordinates to a third party and is tightly rate-limited, so the recommended setup is a self-hosted Nominatim (`mediagis/nominatim`, Sweden extract, `IMPORT_STYLE=address`, `REVERSE_ONLY`) on Traccar's Docker network:
  ```xml
  <entry key='geocoder.type'>nominatim</entry>
  <entry key='geocoder.url'>http://nominatim:8080/reverse</entry>
  <entry key='geocoder.language'>sv</entry>
  <entry key='geocoder.format'>%r %h, %t</entry>
  <entry key='geocoder.ignorePositions'>true</entry>
  ```
  `%r %h, %t` gives Swedish order (street, number, town); Traccar leaves out fields it doesn't get. `ignorePositions` stops Traccar from geocoding every report; panopticon asks only when it needs an address.
- **How often:** only for the selected asset, and again only once it has moved 25 m from where its address was found (`useAddress.ts`). The server rounds points to 4 decimals (about 10 m) and caches up to 1,000 answers (`address.server.ts`), so a stay costs one lookup, and a walk about one every 30 s.
- **When there's none:** no address line. If geocoding is off or failing, the server logs it once and the line stays hidden; failures aren't cached, so it appears once geocoding works.
- The request is a POST, so coordinates stay out of URLs and proxy logs.

## Places

Places such as Home or Daycare, each for some of the assets, are Traccar geofences linked to devices (`places.server.ts`, `lib/places.ts`). Traccar does the work: it checks every position against the device's linked geofences and puts the ones it's inside in the position's `geofenceIds`, and it records `geofenceEnter` and `geofenceExit` events. Panopticon stores nothing.

- **Areas:** Traccar keeps them as WKT, latitude first: `CIRCLE (lat lon, radius)` in metres (not standard WKT) or `POLYGON ((lat lon, ...))`. Panopticon draws circles; polygons drawn in Traccar's own UI are shown and can be renamed and given to assets, but their shape is changed in Traccar. Other shapes aren't shown. Parsing and writing them has tests (`places.test.ts`).
- **Loading:** the map route's loader gets the user's geofences, then each device's (`GET /api/geofences?deviceId=`; Traccar lists a device's geofences but not a geofence's devices), to know which assets each place is for. Without places (an error) the map still loads.
- **On the map** (`map/placeLayers.ts`): a soft area with a dashed outline in `--place` (indigo, unlike the green trail), under the trail, and the name at the top edge, where it doesn't cover an asset that's home, as a solid indigo pill with white text (14 px), so it reads on any map without a blurry halo. Names are DOM labels like the markers', since the map's own text needs fonts a style may not have, and hide while the place is under 24 px across.
- **Editing** (`PlaceEditor.tsx`, `map/PlacePicker.tsx`): Places → a place, or **Add place**, opens a card at the bottom of the map screen with the name, the size and a switch per asset, and **Save** in its header. The circle stays in the middle of the map above the card and the map moves under it, as in Find My. It's a DOM circle over the map, sized from the zoom, so it stays round and smooth during gestures; the map's padding keeps the centre above the card. Sizes go from 50 m to 2 km (`PLACE_RADII`): GPS fixes wander 15–25 m, so smaller circles would see the asset come and go while it sits still. A new place starts where the map is, at 100 m, for every asset. Saving creates or updates the geofence (`PUT` with the full record, as for devices), then links and unlinks devices (`POST`/`DELETE /api/permissions`) to match the switches. Removing deletes the geofence; Traccar drops its links and keeps its events.
- **Who may change them:** the same rule as changing assets (`loadManagedAssets`), since linking a device needs edit rights to it. Others see the list without Add place or editing. Traccar enforces it either way; a refusal shows as "isn't allowed".
- **Where an asset is:** the details card says **Home** instead of the street address while the asset's latest position is inside a place.
- **Arrivals and departures, live:** each live position carries its places, so a change from the asset's last ones is an arrival or a departure (`visitsBetween`). The map screen shows it as a banner at the top, "Betty left Home · 14:02", for 8 s, read out by screen readers; tapping it shows the asset. Only while the app is open: it isn't a notification. Traccar's socket only sends `events` to users with a "web" notification for them, so panopticon doesn't rely on them.
- **Arrivals and departures, history:** the details card lists the latest five from the last week, from Traccar's events report (`GET /api/reports/events?type=geofenceEnter&type=geofenceExit`, asked for as JSON), which Traccar records whether or not anyone is notified. It's fetched again when the asset's places change. Each row is an icon, a few words and the time: an arrival is the place with an arrow going in through a door (green); a departure is how long the asset was out, until its next arrival anywhere, with a winding route (orange): "Out 49 min", or "Out 12 min so far" while it's still out (`visitRows`, `durationLabel`, with tests). Screen readers hear "Arrived at Home" and "Left Home, out 49 min".
- **Alerts** for arriving and leaving, also while the app is closed: see [Alerts](#alerts).

## Alerts

Notifications on a phone when an asset leaves or arrives at one of its places, or its tracker goes offline, also while Panopticon is closed (Settings → Alerts, `AlertsPage.tsx`). Panopticon's server sends them with Web Push when Traccar forwards the event. It still stores nothing.

- **Why not Traccar's own notifications:** its push notificator (`traccar`) only sends to Traccar's Manager app, through traccar.org; the others are Telegram, email, SMS and the like. Panopticon's own notifications need Web Push, sent by panopticon.
- **Hearing about events:** Traccar's event forwarding (`event.forward.url`) posts every event as JSON, with its position, device (and the device's attributes) and geofence, to `POST /hooks/traccar-events` (`alerts.server.ts`). It's only accepted with `Authorization: Bearer <TRACCAR_EVENTS_SECRET>` (`event.forward.header`), compared in constant time, and up to 256 KB; without the variable the route answers 404 and the Alerts page says alerts aren't set up. It always answers 204 once accepted, so Traccar doesn't retry. Events older than 15 minutes (buffered positions) are ignored.
- **Which events:** `geofenceExit` and `geofenceEnter` (a place), and `deviceOffline` or `deviceUnknown` (the tracker went offline; Traccar only records these with `event.status.enable`, off by default since 6.14, and a tracker that goes quiet without hanging up becomes `deviceUnknown` after `status.timeout`, 10 minutes by default), the offline alert at most once per 30 minutes per phone and asset, since trackers on flaky connections come and go (`lib/alerts.ts`, with tests).
- **Settling places:** a tracker at the edge of a place, or a walk along it, crosses it back and forth, and each crossing is a real `geofenceExit` or `geofenceEnter` (Traccar has no setting against it). The first crossing alerts at once, so leaving is never late; further crossings of the same place by the same asset in the next 10 minutes don't. When the 10 minutes are up, one more alert goes out if the asset ended up on the other side from the last alert (it came back, or left again), and starts another 10 minutes (`crossPlace`, `settlePlace` in `lib/alerts.ts`, with tests). Kept in memory, like the offline quiet period: a restart forgets it.
- **Where the choices are kept:** on the assets themselves, as the Traccar device attribute `panopticonAlerts`: per phone, its push subscription, Panopticon's address, its time zone and language (for "At 14:02"), and its rules (`leave:<place>`, `arrive:<place>`, `offline`). Sealed with AES-256-GCM under a key derived from `SESSION_SECRET` (`alertsSeal.server.ts`, with tests): a push subscription lets whoever has it send that phone notifications, and Traccar shows device attributes to everyone who can see the device. The device's id is part of the seal, so it can't be copied to another device. Traccar sends the attributes with each forwarded event, so panopticon needs no storage and no Traccar login of its own to send alerts. About 400 characters per phone; a device's alerts are capped at 3,500 characters (Traccar keeps attributes in a limited column), roughly eight phones, with a message to turn alerts off on an old phone if it's full.
- **Who may change them:** writing the attribute is changing the device, so it needs the same Traccar rights as changing assets, with the user's own token.
- **Web Push** (`webPush.server.ts`, only `node:crypto`, tests including RFC 8291's example message byte for byte): the message is encrypted for the phone (RFC 8291, aes128gcm) and signed with panopticon's VAPID key (RFC 8292). The key is derived from `SESSION_SECRET`, so there's nothing to configure or store; changing the secret turns everyone's alerts off. The VAPID subject is Panopticon's address as the phone opened it, which must be `https` on a real domain: Apple's push service refuses `localhost` and test domains (checked: a real-looking subject gets as far as "BadDeviceToken" for a made-up subscription). Messages go only to Apple's, Google's, Mozilla's and Microsoft's push services (`isPushEndpoint`), so a subscription can't make the server post elsewhere. A subscription the push service says is gone (404, 410) is dropped the next time that asset's alerts are saved.
- **The message** is in Declarative Web Push's format (`{ web_push: 8030, notification: {...} }`): Safari 18.4 and later show it themselves; the service worker (`public/sw.js`, which caches nothing) shows it elsewhere. Tapping it opens the asset's details card (`/?asset=<id>&details=true`). A newer alert about the same asset replaces the last one (`tag`).
- **The phone's side** (`usePhonePush.ts`): **Turn on alerts on this device** registers the service worker and asks for permission on the tap (browsers only ask then). On iPhone and iPad in Safari it says to add Panopticon to the Home Screen, where push works. The iOS Simulator has no push: `getSubscription()` never answers there, so the check gives up after 10 s and says the browser can't show notifications. Turning alerts off removes the phone from every asset, then unsubscribes.
- **Testing locally:** the mock Traccar forwards its live events when `FORWARD_URL` and `FORWARD_HEADER` are set (see `dev/mock-traccar.mjs`); the `panopticon-mock` launch config sets a matching mock-only `TRACCAR_EVENTS_SECRET`.

## Sharing

**Send location** sends where the asset is once, through the system share sheet (`navigator.share`), as a sentence and a map link (`src/lib/share.ts`):
- "Betty is at Storviltsgatan 5, Stockholm." when the fix is at most 5 minutes old, otherwise "Betty was at … (14:05)." with a weekday or date if it isn't today. Without an address, "Betty is here:" and the link.
- The link is Google Maps' documented search URL with the exact coordinates, since it opens for anyone, on any phone, with or without the app. It's only text the user sends; panopticon itself calls nothing.
- Browsers without a share sheet (desktop Firefox) copy the message instead and say so. Closing the share sheet does nothing.

**Live location links** (`/s/<link>`) show one asset, followed live on a map, to anyone with the link and without signing in, for 1, 8 or 24 hours (`liveLinks.server.ts`, `s.$link.tsx`).
- **Why not Traccar's own sharing** (`POST /api/share/device`): it makes one temporary user per sharer and device and reuses it, and that user keeps the expiry of the first share. Once the first link expires, every later one for that device fails with "User has expired", and a normal user can't fix it.
- **Making one:** the server checks the user can see the asset, asks Traccar for a new token for the same user expiring with the link (`POST /api/session/token`; Traccar caps it at the session's own expiry, and so does panopticon), and seals `{asset id, token, expiry}` with AES-256-GCM under a key derived from `SESSION_SECRET` by HKDF (`liveLinkSeal.server.ts`). That's the link: about 250 characters with a real Traccar token. Nothing is stored, so the read-only container stays stateless.
- **Opening one:** the server unseals it, checks the expiry, and reads only that asset with the link's token. The viewer gets the asset's name, picture, status, position and address; never its battery, trail, places, tracker ID, or anything about the sharer or their other assets. Its live stream (`/s/<link>/live`) relays Traccar's socket filtered to that asset, and its picture comes from `/s/<link>/image`.
- **Ending:** at the expiry, Traccar refuses the token and the stream sends an `ended` event; the page then says the link has expired. **Stop** revokes the token (`POST /api/session/token/revoke`, with the link's own token so it can only revoke itself). Traccar keeps an already-open socket going after that, so each stream checks every minute that the token still works and ends if not: a stopped link goes blank within a minute even on a page that's open. Signing out of panopticon doesn't end links; they have their own tokens.
- **Stop needs the link:** panopticon keeps no list, so the links made in a browser are kept in its localStorage (`liveLinks.ts`, with the asset's name) and listed in the Settings card's **Live links**, each with Stop. Other browsers don't see them.
- **No "share" in class names or ids:** content blockers' social filter lists hide elements such as `.share-menu` and `.share-icon` (to remove share widgets from sites). On an iPhone with one, the menu got `display: none` and only its backdrop showed. The menu uses `location-*` and the link page `link-*` instead.
- **Safari and the share sheet:** Safari only opens it straight after a tap. Making a link takes a request first, so if Safari refuses, the Share button turns into **Send link** for a second tap. If that fails too (no share sheet or clipboard, as on a page without HTTPS), the link is shown in a field to copy by hand.
- **Security:** the link is a password to where that asset is until it expires, and anyone it's forwarded to can use it. It can't be read, edited or forged without `SESSION_SECRET` (tests: `liveLinkSeal.test.ts`). If the secret leaked, a link would be as powerful as a session cookie for that account until it expires; that's the same exposure as the cookie itself, and why links last at most 24 hours. The token never reaches the viewer's browser, and Traccar isn't reachable directly anyway. Pages are `noindex`, and `Referrer-Policy: same-origin` keeps the link out of requests to the tile server. Your reverse proxy's access log will contain links if it logs paths.

## Battery

SinoTrack trackers use Traccar's `h02` protocol. The ST-904L sends two kinds of message that matter here:

- **Heartbeats** (`HTBT`): Traccar reads a battery level from these and stores it as `batteryLevel`.
- **Location reports** (`V1`): the battery is there too, but Traccar doesn't know it. After the status field, the ST-904L sends extra values that Traccar stores unnamed as `io1`, `io2`, and so on:
  - `io1`–`io4` are cell info (MCC `240` = Sweden, MNC `01`, then area and cell IDs).
  - `io5` is the number of satellites used for the fix, `0` without one.
  - `io6` is mobile signal strength on the modem scale (CSQ, 0–31, 99 unknown). 12–31 was seen in Stockholm.
  - `io7` is the battery voltage × 10: 35–38, so 3.5–3.8 V.
  - **`io8` is the battery percentage.** Confirmed on 2026-09-29 against Traccar's computed attribute. An earlier reading took `io5` for the battery: its 8 matched a 9% heartbeat by chance, but over a day it runs 0–20 and drops to 0 without a GPS fix, which is satellites.

**Mapping it in Traccar, not the app:** a computed attribute turns `io8` into `batteryLevel` on location reports, so every message has a battery level and other tracker models aren't affected.
- Settings → Computed attributes: Attribute **Battery Level**, which makes the type Number. Expression: `io8 != null && io8 * 1 >= 0 && io8 * 1 <= 100 ? io8 * 1 : null`. Linked to the tracker, or to its group.
- `io8 * 1` turns the text into a number without enabling `processing.computedAttributes.newInstanceCreation`. Traccar discards non-numbers for Number attributes; the attribute has to be Battery Level, or Traccar tries to store the result as the wrong type and drops it.
- Traccar runs these expressions strictly. On a heartbeat, which has no `io8`, the expression fails with a logged warning and the heartbeat's own battery level stays. If the expression returned null there instead, Traccar would remove the attribute.

In the app:
- `battery` is optional in the view model. The value comes from `batteryLevel` (percent) or `battery` (volts), whichever Traccar has.
- The card shows battery only when it exists. There's no placeholder.
- Live updates never blank a known battery value; a position without battery keeps the last one seen in that session.
- The value is the tracker's estimate from its voltage, so it moves with load and temperature: 8% → 12% → 19% while moving was seen on 2026-09-26. The gauge's bars absorb most of this.

## Tracker details

Each asset's page under **Assets** (the Settings card) has a **Tracker** section, below Name, about the tracker itself (`TrackerSection.tsx`), for anyone who can see the asset, including accounts that can't change it.

| Row | From |
|---|---|
| Connection: Online · last contact 20 s ago | device `status`, `lastUpdate` |
| GPS: "Fix, 19 satellites", or "No fix since 14:05" / "No fix for over an hour" | the latest report's `valid`; satellites from `sat`, or `io5` on h02; the last fix from an hour of history |
| Mobile signal: bars and Poor / Fair / Good / Excellent | `io6` on h02, read as CSQ: under 10 poor, 10–14 fair, 15–19 good, 20 and up excellent |
| Network: Telia · Sweden | the serving cell's country and network codes (`network.cellTowers`, or `io1`/`io2` on h02); names for the Nordic countries and the main Swedish operators, codes otherwise |
| Battery: 62% · 3.7 V | `batteryLevel`; volts from `battery`, or `io7` / 10 on h02 |
| Reports: about every 30 s | the median time between reports over the past hour |
| Last fix: coordinates, with Copy | the latest position |
| Model: ST-904L (h02) | the device's model in Traccar, and the protocol |

- **Fetched when the page opens** (`getTrackerDetails`), and every 30 s while it's open, rather than streamed with the map's data. It reads the device, the latest positions and an hour of that device's history. The mapping is a pure function (`tracker.server.ts`) with tests against real ST-904L values.
- Only rows the tracker reports are shown. Never the tracker ID (IMEI) or the SIM's number, and live link viewers never see it.

## UI

The look is [Konsta UI](https://konstaui.com): native-looking iOS and Material components for React, on Tailwind CSS. See [Look and feel](#look-and-feel) for how it's set up.

- **Front page** (`/welcome`, `welcome.tsx`): where the map sends visitors who aren't signed in, and where signing out lands. A picture on top (`WelcomeScene.tsx`, inline SVG and CSS, no requests): a folded paper map with a dog, a briefcase and a bike on it as paper cutouts with white backing and hard shadows, a little like Paper Mario or Yoshi's Island, in a few RAL colours; a day map in light mode and a night map in dark mode (`--scene-*` in styles.css). The cutouts bob, the trails march and the clouds drift, all still with Reduce Motion. Then the title, centred, as a paper cutout too (`.paper-title`: SF Pro Rounded at its heaviest via `ui-rounded`, built into iOS and macOS, with a white edge and hard shadow; other systems use their bold), a one-line tagline, **Sign in** (or **Open the map** when signed in) with "or deploy it yourself" under it, linking to the GitHub repository, and **What it does**: the main features as stops on a trail (`FeatureTrail.tsx`: paper-cutout badges alternating left and right, each with its text on a tilted post-it note, joined by a marching dotted path that runs between the stops, never through their text; drawn from where the stops end up, so it follows any text length or size), then **What it looks like**: screenshots of the app on an iPhone in a row that scrolls sideways and snaps (`ScreenshotGallery.tsx`), light or dark to match the visitor's mode (`<picture>` with `prefers-color-scheme`), lazily loaded from `public/screenshots` (600 px JPEGs, about 120 KB each). Above it, **How the tracking works** (`HowItWorks.tsx`): a tracker, your Traccar server and Panopticon as three numbered steps, and how many trackers Traccar works with, from its own device list (2,000+ models, 200+ protocols, rounded down so they stay true), with a link to it. They were taken in the iOS Simulator against the mock Traccar, so they show made-up assets and places only; retake them the same way when the UI changes. And that it needs a Traccar server. On a wide screen (Tailwind's `lg`, 1024 px and up) it isn't a phone column: the picture and the title, tagline and Sign in side by side, centred section headings, the trail's post-its narrower so the stops zig-zag across, and all four screenshots side by side.
- **Sign-in page** (`/login`, `login.tsx`): "Sign in" as a paper title, the methods `SIGN_IN_METHODS` allows (see [Which methods](#which-methods)), and a **What is Panopticon?** link to the front page. A session that runs out sends the browser straight here.
- **Pages:** `/welcome` (the front page), `/login`, and `/`, the map, whose Settings card holds the settings and [managing assets](#managing-assets). `/s/<link>` is a [live location link](#sharing), the only page that doesn't need signing in. The selected asset and the Settings card's view are search params (`/?asset=12&settings=asset-30`), so they survive a reload.
- **Map screen:** the map fills the screen, with two bars floating along the bottom like Apple Maps' (`BottomBar.tsx`, the cards in `SettingsCard.tsx`): one with the your-position button and each asset's picture, as wide as they need (stale ones grey). When they don't fit, the pictures scroll sideways while the your-position button stays put, fading out to transparent at an edge with more past it (a CSS mask, updated on scroll), and at the right, a round one of its own, the Settings button (the signed-in user's initial). Both are 64 px tall with 48 px pictures and buttons. Up to 1024 px wide they sit in a 576 px column in the middle; wider, they span the window, the assets' bar at the left edge and Settings (with the zoom buttons above it) at the right, 12 px in like the Live pill. The map's zoom buttons sit above the bar, and fitting the map to assets leaves room for it (`clearOfBottom` in map/AssetMap.tsx).
  - **Asset pictures:** the first tap selects the asset and centres the map on it (and follows it, as selecting on the map does). Tapping the selected asset's picture again re-centres it and opens its **details card** (`AssetDetailsCard.tsx`) from the bottom, like Apple Maps' place card: its picture, name, status and battery, then what it's doing, the address, when it was seen, and **Share**. The card has no backdrop, so the map can still be moved; ✕, Escape or the back gesture closes it, and focus goes back to what opened it, the asset's picture (`?details=true`, with a history entry of its own when opened here, as the Settings card has). Selecting another asset on the map replaces it.
  - **Settings card:** the button opens a card from the bottom, like Apple Maps' profile card: the user's initial, name and email, then **Assets** (with the count), **Appearance**, **Places** (the count), **Live links** (the count made in this browser) and **Account**. Under the list, small, the map data's credits (see [Map tiles](#map-tiles)). It's as tall as both, at any text size, and scrolls on short screens. The button and the card are called Settings; the card's view is the `settings` search param.
  - **Page card:** Assets, Appearance, Places, Live links and Account each open a second card from the bottom, over the Settings card, like Apple Maps' Places: from just below the status bar to the bottom of the screen, with a large title and ✕ back to the Settings card. Appearance has **Map style** (see [Map tiles](#map-tiles)) and **Trail** as checkmark lists, then **Walks**: **Paw prints** and **Snap to paths** as switches, the second greyed out without a map-matching server (`Appearance.tsx`), Places the list of places with **Add place** (`PlacesList.tsx`; a place opens in the editor on the map, see [Places](#places)), Live links the list with Stop (`LiveLinksList.tsx`), Account the signed-in name and email with **Sign out**, and Assets the asset list (see [Managing assets](#managing-assets)). Add asset and an asset's own page open inside the Assets card, sliding in sideways (`.card-view-forward`/`-back`, none with reduced motion), with "‹ Assets" back. The map stays behind the cards, so a new trail length or a renamed asset shows at once.
  - **Views in the address:** `?settings=main` (the Settings card), and `appearance`, `places`, `live-links`, `account`, `assets`, `add-asset` or `asset-<id>` for the page card over it (`parseSettingsView` in SettingsCard.tsx). `&place=<id>` or `&place=new` opens the place editor over the Places page; the cards hide while it's open, and closing it goes back to the list. Opening the Settings card adds a history entry, and opening a page card from it another, so the back gesture closes them one at a time; moving within the page card replaces its entry. ✕, Escape or tapping outside closes the top card. When a card was opened here, closing it goes back in history past its entries; when the page loaded with it open, closing just changes the param. `useCardHistory` in index.tsx keeps the list of cards opened here, for the details card too, and drops a card when it goes from open to closed some other way (the back gesture).
  - Focus moves to the top card's ✕ (or "‹ Assets") as it opens, and back to the Settings button when everything closes, with `preventScroll`: without it the browser scrolls the map screen to bring the button into view while the card is still moving, and the whole screen jumps. For the same reason the map screen is `overflow: clip`, not `hidden`: a hidden box can still be scrolled, and focusing a control in a card that's off-screen shifted it up by 250 px in testing. Cards underneath and closed cards are `inert`.
  - **Wide screens** (1024 px and up, `sidePanel` in `cards.tsx`): the cards are side panels instead of sheets from the bottom, like Apple Maps' sidebar on a Mac: 380 px wide, 12 px in, from below the Live pill down to above the bottom bar, sliding in from their side, on the side of what opened them. An asset's details card and its Share card are on the left (its picture is at the bottom left); the Settings card, its page cards and the place editor on the right (Settings is at the bottom right). Content-height cards (details, Settings) hug their content; page cards fill the panel. The place editor stops above the zoom buttons, since it leaves the map usable, and reports the side it covers (`Inset`), so the circle sits in the middle of the map to its left.
  - Not Konsta's `Sheet`: it's `position: fixed`, which stops 59 pt short of the screen's bottom in the iOS home-screen app (see Home screen below). The bar, the card and its backdrop are absolute inside the map screen.
  - The email is kept in the session cookie from sign-in; sessions from before it was kept show the name only.
- **Details card content** (`AssetDetailsCard.tsx`): the asset's picture, name, online/offline status and battery percentage, then:
  - while riding, **In a vehicle** or **Moving underground**, in the accent colour;
  - the place it's at, such as **Home**, or else the street address (see [Addresses](#addresses));
  - "Seen 4 minutes ago", from `fixTime` using `Intl.RelativeTimeFormat`, re-rendered every 30 s, with "Here since 07:12" while it's staying put (`currentStay` in segments.ts: the trail's last piece is a stay and reports are recent; when the stay goes back to the start of the loaded history, "since before");
  - "Last contact …" when there's no location, or contact is more than 5 minutes newer than the fix;
  - **Share** (and **Sharing live**), see below;
  - **Arrivals and departures**, when it has places: the latest five of the last week, as icons: the place it arrived at, or how long it was out, such as "Out 49 min · 16:58" (see [Places](#places)).
  - **Battery:** a gauge with 0–4 bars (empty below 5%, then one bar per started quarter), orange at 20% or below. The exact percentage is its label, for screen readers and as the hover tooltip. Readings near empty jump by several points as the voltage recovers, and bars hide most of that. Trackers that report volts only get a text line instead.
  - The Live indicator sits in the map's top-left corner, and the map's buttons (`map/MapButtons.tsx`) on the right: + and − just above the Settings button on the map screen, as wide as it (64 px) so their edges line up, or your position, + and − under the status bar on live link pages, which have a panel instead of the bar. Both are pills like the bar: the same colours (Konsta's surface for iOS or Material, light or dark), shadow and line icons, 12 px from the screen's edges. maplibre's own controls aren't used.
- **Share:** a button in the details card. It opens the **Share card**, a second-level card like Settings' pages (full height, large title, ✕; drawn into the map screen with a portal, so it covers the screen rather than the details card): **Send location**, and **Share live location** for 1, 8 or 24 hours. Escape closes just it (a capture-phase listener that stops there), and closing the details card closes it too. While a live link made in this browser is active, a **Sharing live** button sits beside Share and opens the Settings card's Live links (`/?settings=live-links`), where links are stopped. See [Sharing](#sharing).
- **Home-screen app and the status bar:** the page asks for `viewport-fit=cover` and a see-through status bar (`apple-mobile-web-app-status-bar-style: black-translucent`), so the map reaches the top of the screen. A soft shade behind the status bar keeps its white text readable, and the map's controls and the Live indicator sit below `env(safe-area-inset-top)`; the other pages' bars do the same (Konsta's safe areas).
  - **An iOS quirk**, measured on an iPhone (screen 852 pt, status bar 59): in that mode the page starts under the status bar, but iOS reports the viewport one status bar shorter. `100%`, `100dvh` and `position: fixed; bottom: 0` all stop at 793, and fixed elements are cut off below it, which first showed as a tall empty band under the asset row. Only `100vh`/`100lvh` are the full 852. So in `display-mode: standalone` the map page is laid out with `position: absolute` and `height: 100lvh`, with scrolling turned off, instead of pinned. Not in Safari itself: there `100lvh` is the height with its toolbars hidden, which would put the map's bottom edge under them.
- **Map:** tapping an asset's picture in the bottom bar, or its marker, selects it and flies to it. Tapping the selected asset's marker deselects it when it's centred (being followed, or within 12 px of the middle); when it's off-centre, for example after a drag, the tap re-centres it and resumes following instead. On load the map shows the asset in `?asset=`, or fits all assets.
- **Deselecting:** tapping the selected asset's marker while it's centred. Closing the details card keeps the selection, and so does tapping or dragging the map.
- **Following:** while an asset is selected, the map keeps it centred, gliding to each new position (1 s).
- **Centred in what's visible:** "centred" is the middle of the map that's visible, not of the screen: above the bottom bar, above the details card when it's open on a phone, beside the side panels on a wide screen (the details card on the left, Settings on the right), and above the panel on a live link page, as Apple Maps keeps a pin above its card. Each card reports what it covers while open (`useCover` in `cards.tsx`, from where it sits when open, kept up to date as its height changes), and AssetMap sets maplibre's padding to match, so following, selecting, the re-tap check, zooming around the centre and framing (your position, fitting all assets) all use it. When it changes, a followed asset glides along with the card (300 ms, as long as the card's slide, re-aiming a selection flight on its way); otherwise the map stays where it is and only its middle moves. On a phone the Settings card is a sheet over most of the map, so it doesn't count there. The place editor's picker sets the padding itself while it's open. A move that was to change the padding and got cut short is put right once the map is at rest.
  - **Dragging pauses it:** a mouse or one-finger drag, or panning with the arrow keys, stops following but keeps the asset selected. Tapping its marker again, or selecting another asset, resumes. The pause is tied to the selection it was made in (`focusToken`), so it never carries over to the next one.
  - **Zooming keeps following:** scroll wheel, pinch, +/− and double-tap. While following, wheel and pinch zoom around the centre instead of the cursor or fingers. After a zoom gesture (a double-tap zooms around the tap; a pinch drifts, which maplibre reports as a two-finger drag and is ignored) the map glides back to the asset.
  - Position updates that arrive during a selection flight or a zoom gesture don't interrupt it; the map catches up when it ends. Those waits only apply while the map is actually moving, so a missed end event can't stop following.
  - Only real gestures pause following: maplibre fires `dragstart` for user drags, never for the app's own camera moves.
- **Your position:** the location arrow at the left of the bottom bar (on a live link page, the top of the map's buttons) shows where you are, as a blue dot with a soft circle for its accuracy (`useMyPosition.ts`, `myPosition.ts`). It's off each time the app opens; the first tap asks the browser for permission. The first fix frames you and the selected asset together, which pauses following like a drag (tapping the asset resumes it), or just you when nothing is selected. Tapping the button again turns it off. If the browser refuses or can't find you, a short note says so and it switches off. Your position stays in the browser: it's only drawn, never sent anywhere. Live link pages have the button too.
- **Markers:** maplibre DOM markers (enough for ≤5): a dot with the asset's picture or initial and a name label. Greyed out when the fix is older than 30 minutes; a ring when selected (same size, so selecting doesn't shift it).
  - No accuracy circle yet: the ST-904L reports no accuracy, so it would never show. Add it when a tracker does.
- **Rendering:** maplibre runs in the browser only, lazy-loaded in a client-only component. The server-rendered HTML shows a placeholder where the map goes, and maplibre stays out of the first-load bundle.
- **maplibre worker:** v6 looks for its worker script next to its own file, which breaks once bundled. Vite bundles it instead (`?worker&url`, `worker.format: 'es'`), and `setWorkerUrl` points maplibre at the same-origin result.
- **Data freshness:** the `/` loader reloads when you arrive on the map (`shouldReload: cause !== 'stay'`), not when you select an asset. Live updates keep it current in between. Nothing is kept from an earlier visit (`gcTime: 0`).
- **Loading screen** (`LoadingScreen.tsx`): the map screen's loader doesn't wait for Traccar. It hands its server functions' promises (assets, places, map options) to the page unawaited, so the server sends the page at once, with the loading screen, and streams each part in as Traccar answers it. Before, nothing showed until Traccar had answered everything. The screen shows the front page's paper map, a progress bar and four steps, each with when it was done counted from when loading began (the server's part included), so a slow load shows where the time goes:
  1. Your assets (`getAssets`)
  2. Places (`getPlaces`, one Traccar request per tracker)
  3. Map (the map code, then the map's first frame with its style and the tiles in view. maplibre's own `load` waits for every source to be idle, which trail and live updates keep putting off)
  4. Trails (the first trail history)

  The map screen appears behind it once the assets, places and map options are in. The screen fades out once the map is ready and the trails are in, or 2 s after the map if the trails are slower. A small "Loading trails" note then shows under the Live pill until they come. If the map never gets ready (say, its tiles can't load), the screen goes 8 s after the data. Each streamed part settles to plain data (`{ value }`, `{ signedOut }` or `{ failed }`), since a redirect can't be streamed. A part that failed shows "Couldn't reach Traccar" with Try again. When Traccar refused the token, the page had already gone out, so the server couldn't clear the session cookie. The page asks again, not streamed, which clears it and leads to the sign-in page. If the session is fine after all, it just reloads. Reloads later on (reconnecting, coming back to the tab) swap the new data in without the loading screen.
- **Trying it:** `DELAY_MS=800 node dev/mock-traccar.mjs` makes the mock a slow Traccar (every request 0.8 s, position history three times that). The `panopticon-prod-mock` launch config runs the production build against it on port 3002.
- **Settings** (in the Settings card, above): Settings live in `localStorage`, per browser. They're a convenience: without storage, the defaults apply. Server render and hydration use the defaults, so the page waits for the stored value before fetching trail history.
- **Home screen:** `public/manifest.webmanifest` plus icons (`icon.svg`, 192/512 px maskable PNGs, 180 px `apple-touch-icon`), so the app can be added to the home screen and opens full-screen. No service worker, and no offline use.

## Asset images

Markers show the picture uploaded for a device in Traccar's own UI (device settings → image), with the initial letter as the fallback.

- **Where Traccar keeps them:** Traccar stores an upload as `<uniqueId>/device.<jpg|png|gif|webp>` (up to 500 KB). Its web UI saves the filename in the device attribute `deviceImage`, and the file is served at `/api/media/<uniqueId>/<file>`.
- **Serving:** the browser gets `imageUrl: /images/asset/<id>?v=<file>` and nothing else. The server route:
  - looks the device up with the user's token (`GET /api/devices?id=`), which is also Traccar's permission check;
  - fetches the file and returns it with a content type derived from the extension.
  The device's `uniqueId` stays on the server. It's often the IMEI, and h02 trackers send positions without authentication, so knowing it would let someone fake positions.
- **Traccar's media endpoint only accepts a session cookie,** not API tokens. So fetching an image opens a session from the token (`GET /api/session?token=`) for that one request and ends it right after. Images are then kept in memory for 5 minutes (at most 50), and served with `Cache-Control: private, max-age=300` and an ETag, so most loads cost Traccar nothing.
- **Accepted filenames:** only `device.<ext>` is used; anything else in `deviceImage` is ignored, which also rules out odd paths.
- **Marker behaviour:** the `<img>` sits on top of the initial and hides itself if it fails to load. Live updates only touch the `<img>` when the URL changes, so it doesn't reload. Markers with a picture are larger (2.75 rem), and stale ones turn grey.
- **Updating a picture:** Traccar saves every upload as `device.<ext>`, so the filename alone doesn't change the URL.
  - Uploaded in panopticon: shows at once. The server drops its cached copy and adds its own version to the URL (`?v=device.jpg-<time>`). That version is kept in memory, so after a restart URLs go back to `?v=<file>`, which only matters within 5 minutes of an upload.
  - Uploaded in Traccar's UI: can take up to about 10 minutes to show everywhere (5 minutes of server cache, then up to 5 minutes of browser cache).

## Managing assets

**Assets**, in the Settings card (`AssetsList.tsx`), lists every device the user can see, including ones disabled in Traccar. From there you can add an asset (name and tracker ID, `AddAssetForm.tsx`), and on each asset's page (`AssetEditor.tsx`) see how its tracker is doing ([Tracker details](#tracker-details)), change its photo, rename it or remove it. Only these three fields are handled; groups, phone numbers, models and categories stay in Traccar's UI.

- **Traccar calls** (`traccar.server.ts`):
  - Add: `POST /api/devices` with `{name, uniqueId}`. Traccar links the new device to the user who creates it.
  - Rename: `PUT /api/devices/<id>`. The PUT replaces the whole record, so the server fetches the device (`GET /api/devices/<id>`), changes `name` on the full JSON and sends all of it back. Fields panopticon doesn't know about survive.
  - Photo: `POST /api/devices/<id>/image` with the image bytes, which returns `device.<ext>`; then a PUT sets the `deviceImage` attribute, as Traccar's UI does. Removing a photo clears the attribute. Traccar has no endpoint to delete the file, so it stays in its media folder.
  - Remove: `DELETE /api/devices/<id>`, after a confirmation step on the page.
- **Who may change what:** Traccar decides (`PermissionsService.checkEdit`). Admins may do anything. Other users are refused when the server or their account is read-only or device-read-only, and adding is refused at their device limit (0 means none). The server reads these from `GET /api/session?token=` and `GET /api/server` only to hide controls that would fail; Traccar still enforces them. That endpoint ignores the `Authorization` header and only reads the HTTP session, so, as for images, the token opens a session just for the lookup, which is ended right after.
- **Errors:** Traccar answers refusals with HTTP 400 and the exception message in the body, so a refusal is never mistaken for an expired sign-in. `manage.server.ts` turns them into results the page explains: not allowed, tracker ID already used (the database's unique index), not found, image refused, or unavailable.
- **Photos:** phone photos are several MB, and Traccar's limit is 500 KB. The browser crops them to a centred square and shrinks them to 512 px JPEG with a canvas (`assetImage.ts`), with no new dependency. The server checks the size again and reads the type from the file's first bytes, not from what the browser declares.
- **Tracker ID:** the browser sends it once, when adding. It's never sent back: the pages show only name and photo, for the same reason as in [Asset images](#asset-images).
- **After a change** the pages reload their data (`router.invalidate`), and the map reloads its list when you return to it.

## Look and feel

[Konsta UI](https://konstaui.com) (v5) provides the components: lists, navigation bars with large titles, toggles, buttons, dialogs. It's built on Tailwind CSS v4, which the app uses for its own layout too. The one hand-written stylesheet left (`styles.css`) holds the accent colour and the map: markers, overlays, controls and the status-bar fixes.

- **iOS or Material:** Android gets Material Design, everything else (iPhones, iPads, desktops) iOS (`platform.ts`). It's decided from the User-Agent, on the server too (`platform.server.ts` in the root route's `beforeLoad`), and handed to Konsta's `<App theme>`, so the first render already has the right look. Konsta picks its classes in JavaScript, so this can't be left to CSS.
- **Light and dark:** Konsta's dark mode is a `.dark` class on `<html>`. `public/color-scheme.js`, a blocking script in `<head>` (allowed by the CSP as a same-origin file), sets it from `prefers-color-scheme` and follows changes. It runs before the first paint, so there's no flash; `<html>` has `suppressHydrationWarning` because the server never renders the class. Redefining Tailwind's `dark:` variant as a media query instead doesn't work: Konsta's own definition wins.
- **Dynamic Type:** on iPhones and iPads the root font is `font: -apple-system-body` (touch devices only; on a Mac it's 13px), so it follows Settings → Display & Text Size: 17px at the default, up to about 53px at the largest accessibility size. Text is in `rem` and grows with it, and list rows, buttons and cards grow with their text. Margins, paddings and gaps stay one size, as in iOS: Tailwind's `--spacing` is fixed at 4px (styles.css), and Konsta's fixed button and input heights are minimums instead. Konsta's few fixed text sizes (17px, 15px) are overridden to `rem`, and large titles use `calc(0.7rem + 22px)`, which grows more slowly, as iOS's large titles do (34px at the default, about 59px at the largest). Text one size whatever the setting, as in iOS: the map's chrome (bottom bar, map buttons, Live pill), the initials in pictures (`.fixed-size`, which fixes Tailwind's text variables), the asset page's navigation bar, and the map's markers. Long words in list rows break, hyphenated, at the largest sizes; cards that outgrow the screen scroll. Android Chrome follows its text size through the `text-scale` meta tag. Checked in the iOS Simulator (iOS 18.5 and 27) at the default size, XXXL and the largest accessibility size.
- **Colours:** the accent is the app's green (`--color-brand-primary` in `@theme`); Konsta derives its iOS and Material shades from it. The map's colours (`--trail`, `--place`, `--marker`, online/offline/stale) are CSS variables with a `.dark` block. What's drawn on the map (the trail, places and their labels, the place picker, the markers and their name labels) follows the map style instead, a day or a night map, whatever the device's mode: the map element has `.map-light` or `.map-dark` (each style says whether it's dark in `mapStyles.ts`; a self-hosted style is taken to be a day map), which sets those variables again. The controls around the map (Live, buttons, banners, cards) follow the device. AssetMap reads `--trail` and `--place` from the map element via `getComputedStyle`, because map paint properties can't use CSS variables, and repaints them when switching between a day and a night map. Online is iOS green, offline iOS orange.
- **Older phones:** the costliest thing on old GPUs is blur (`backdrop-filter`) re-rendered under a moving map. Nothing over the map blurs: the cards and pills are solid. Tailwind v4 needs iOS 16.4 or later (`@property`, cascade layers): iPhone 8 and later.
- **CSP:** Konsta ships static CSS and sets its few computed styles (segmented highlights, popovers) from JavaScript on the client, which `style-src 'self'` allows. Checked in a production build: no `style=""` attributes or `<style>` tags in the server-rendered HTML, and no violations on any page.
- **Weight:** about 16 KB of CSS and 27 KB of JavaScript (both gzipped) for the whole app, against 280 KB for maplibre.
- **Not used:** Konsta's strong `Segmented` control (its sliding highlight lagged one tap behind in testing), and its `Sheet` (no dragging). The pet theme ("Petopticon", pastels, and paw-print trails, now a setting of their own) was dropped with the move to Konsta.

- **App icon:** a folded paper map with a red paper-cutout pin on the app's green, in the front page's style and RAL colours. `public/icon.svg` (rounded corners) is the browser's icon; the PNGs (`icon-192.png`, `icon-512.png`, `apple-touch-icon.png` at 180 px) are `dev/icon-full.svg`, the same without rounded corners, since iOS and Android round them (the art stays inside Android's round safe zone). To render them: `/Applications/Chromium.app/Contents/MacOS/Chromium --headless --disable-gpu --hide-scrollbars --screenshot=$PWD/icon-1024.png --window-size=1024,1024 file://$PWD/dev/icon-full.svg`, then `sips -Z 512 icon-1024.png --out public/icon-512.png`, and 192 and 180 likewise. Headless Chromium mis-renders small windows, so render at 1024 and scale down.
- **Link previews:** sharing the front page's address (in iMessage, Slack, WhatsApp and the like) shows a picture, the title and the description, from Open Graph tags in `welcome.tsx`'s `head`. The picture is `public/og-image.png`, 1200 × 630: the paper-map scene with the title and the tagline, made from `dev/og-image.html` (the scene's SVG and styles as the page renders them, frozen mid-bob; the title in Nunito Black, SIL Open Font License, since SF Pro Rounded may not be baked into an image). To render it: `/Applications/Chromium.app/Contents/MacOS/Chromium --headless=new --disable-gpu --hide-scrollbars --virtual-time-budget=5000 --screenshot=$PWD/public/og-image.png --window-size=1200,630 file://$PWD/dev/og-image.html`. Previews need the picture's full address, so the page's loader asks the server for its own (`getSiteOrigin`, `site.functions.ts`): the reverse proxy's `X-Forwarded-Proto` and `X-Forwarded-Host` (or `Host`), the first of each when proxies chain, and the request's own address when they're missing or malformed.

## Map tiles

- `MAP_STYLE_URL` is optional. The default is OpenFreeMap's `bright` style: free, no API key, no analytics. OpenFreeMap does see which map areas you load.
- **Map style** (Settings → Appearance): with OpenFreeMap, a checkmark list of its five free styles, **Standard** (liberty), **Light** (positron), **Bright**, **Dark** and **Dark blue** (fiord), plus **Auto**, which is the default style (Bright) in light mode and Dark in dark mode (`mapStyles.ts`). The choice is kept per browser (`mapStyle` in the settings); a live link page uses the viewer's stored choice, or the default, and has no picker of its own. The default is the style `MAP_STYLE_URL` names. With a self-hosted style there's nothing to choose between, so the section isn't shown. Switching between a day and a night map (by hand, or with Auto when the phone switches between light and dark) swaps the map style and recolours the trail and places; the recolouring waits for the new style (`isStyleLoaded`), since maplibre throws on the old style's layers while the new one loads, which crashed the page before.
- **Switching keeps the view:** the map isn't rebuilt; `setStyle` loads the new style (a full reload, not a diff) and `style.load` adds the trail and your-position layers again. Markers are DOM elements, so they stay. All of OpenFreeMap's styles share one origin, so the Content-Security-Policy needs nothing new.
- **Attribution** ("OpenFreeMap © OpenMapTiles Data from OpenStreetMap"): in small print, in the Settings card under its list on the map screen, and in the panel on live link pages (`MapCredits.tsx`); not on the map. AssetMap reads it from the style's sources as they load, as maplibre's own control does, and hands it out (`onAttribution`); it's HTML from the style, so only its text and its http(s) links are shown, never the HTML itself (`parseCredit` in credits.ts, a small parser with tests: other tags, scripts and other links only ever come out as text). A self-hosted style's own credits show the same way. OpenStreetMap's attribution guidelines ask for credit on or next to the map: on live link pages it's next to it; on the map screen, keeping it in the Settings card is a deliberate choice for a private app.
- No satellite imagery: there's no free provider without an API key that doesn't see where you look.
- To use no third-party service, run your own tile server and point `MAP_STYLE_URL` at its style JSON. For example: `pmtiles serve` with a Protomaps extract, or Martin. This needs no app code changes and adds no dependency.
- The Content-Security-Policy allows the origin of `MAP_STYLE_URL` for tiles, fonts and sprites.

## Project layout

```
server.mjs                            production server: srvx + static files + Start handler
Dockerfile, .dockerignore
public/                               manifest + icons, color-scheme.js (dark mode), sw.js (alerts), screenshots/ (front page), copied to dist/client
dev/mock-traccar.mjs                  a stand-in Traccar with made-up assets, for development
dev/icon-full.svg                     the app icon without rounded corners, for the PNG icons
dev/og-image.html                     the front page's link preview picture, rendered to public/og-image.png
src/
  start.ts                            request middleware: CSRF for server functions, security headers
  router.tsx                          also sets the per-request CSP nonce for Start's inline scripts
  routes/
    __root.tsx
    welcome.tsx                       the front page: what Panopticon does, and Sign in
    login.tsx
    index.tsx                         map, bottom bar and Settings card (protected)
    auth.sso.ts                       server route: start SSO
    images.asset.$id.ts               server route: asset picture
    api.session.openid.callback.ts    server route: SSO return (path fixed by Traccar)
    live.ts                           server route: SSE relay
    hooks.traccar-events.ts           server route: Traccar's forwarded events, for alerts
    s.$link.tsx                       live location link page (public)
    s_.$link.live.ts                  server route: a live link's SSE stream
    s_.$link.image.ts                 server route: a live link's asset picture
    $.ts                              Traccar email links → 302 to Traccar; else 404
  server/
    env.server.ts                     read + validate env once
    traccar.server.ts                 typed fetch client for the endpoints above
    session.server.ts                 sealed cookie, token exchange, withToken()
    assets.server.ts                  Traccar → Asset mapping
    auth.functions.ts                 getUser / loginWithPassword / logout
    assets.functions.ts               getAssets, getTrackerDetails
    tracker.server.ts                 Traccar → tracker details (SinoTrack io fields) + tests
    manage.server.ts                  add / rename / remove assets and photos; edit access; error mapping
    manage.functions.ts               server functions for managing assets, with input checks
    map.functions.ts                  getMapOptions (style URL, whether Snap to paths is available), matchWalks, getAddress
    address.server.ts                 street addresses through Traccar's geocoder, cache
    matching.server.ts                Valhalla map matching, closeness check, cache
    images.server.ts                  /images/asset/<id>: device pictures from Traccar, cached
    platform.server.ts                iOS or Material, from the request's User-Agent
    trails.functions.ts               getTrails (position history)
    security.server.ts                CSP nonce + security headers
    live.server.ts                    /live: WebSocket → SSE relay (also used by live links)
    liveLinks.server.ts               live location links: make, open, stream, stop
    liveLinks.functions.ts            createLink / stopLink (signed in), getSharedView / getSharedAddress (public)
    liveLinkSeal.server.ts            sealing links (AES-GCM, key from SESSION_SECRET) + tests
    sso.server.ts                     /auth/sso, callback, Traccar email-link redirects
    places.server.ts                  places as Traccar geofences: load with their assets, save, remove, visits
    places.functions.ts               getPlaces, savePlaceChange, deletePlace, getPlaceVisits
    alerts.server.ts                  alerts: the Traccar events hook, this phone's choices onto the devices
    alerts.functions.ts               getAlertSetup, savePhoneAlertChoices, sendPhoneTestAlert
    alertsSeal.server.ts              sealing a device's alert choices (AES-GCM) + tests
    webPush.server.ts                 Web Push: encryption (RFC 8291), VAPID (RFC 8292), sending + tests
  components/
    map/
      AssetMap.tsx                    the maplibre map (browser only, lazy): following, selection, your position
      trailLayers.ts                  the trail's layers: lines, rides, stay circles, paw prints
      placeLayers.ts                  places on the map: areas, outlines, name labels
      PlacePicker.tsx                 the circle being placed, in the middle of the map above the editor
      markers.ts                      the assets' markers
      MapButtons.tsx                  + and − (and your position on live link pages), as a pill like the bar
      myPosition.ts                   your position on the map: dot, accuracy circle, button icon
      geometry.ts                     a circle of metres as a ring of coordinates
    BatteryGauge.tsx                  battery as 0–4 bars
    BottomBar.tsx                     the map's bottom bar: your position, asset pictures, Settings
    SettingsCard.tsx                  the Settings card and its page cards (assets, appearance, places, live links, account)
    UserInitial.tsx                   the signed-in user's initial
    MapCredits.tsx                    the map data's credits, in small print
    icons.tsx                         the small line icons
    AssetDetailsCard.tsx              the selected asset's details card
    cards.tsx                         what the map screen's cards share: colours, ✕, backdrop
    AssetsList.tsx                    the assets to manage
    AddAssetForm.tsx                  add an asset
    AssetEditor.tsx                   an asset's photo, name, tracker details, remove
    Appearance.tsx                    map style, trail length, paw prints, snap to paths
    LiveLinksList.tsx                 this browser's live links, with Stop
    PlacesList.tsx                    the user's places, with Add place
    PlaceEditor.tsx                   a place's name, size and assets, in a card over the map
    PlaceVisits.tsx                   an asset's latest arrivals and departures
    PlaceBanner.tsx                   "Betty left Home", at the top of the map
    AlertsPage.tsx                    Settings → Alerts: this phone's alerts, test, turn off
    AssetAvatar.tsx                   picture, or initial as the fallback
    LiveIndicator.tsx                 Live / Connecting / Offline
    UpdateNotice.tsx                  Update available · Reload, after a new release
    WelcomeScene.tsx                  the front page's picture: a paper map with a dog, a briefcase and a bike
    FeatureTrail.tsx                  the front page's features as stops on a dotted trail
    ScreenshotGallery.tsx             the front page's screenshots, light and dark
    HowItWorks.tsx                    the front page's How the tracking works, with Traccar's tracker counts
    TrackerSection.tsx                the Tracker section of an asset's page
    Share.tsx                         Share: send location, make and send live links
    RelativeTime.tsx
  lib/
    asset.ts                          Asset view model + isStale (shared with the browser)
    useNow.ts                         ticking clock for relative times
    live.ts                           LiveUpdate type + applyUpdates (shared with the server)
    trail.ts                          trail types, extend/prune
    places.ts                         Place type, Traccar's WKT areas, arrivals and departures + tests
    alerts.ts                         alert rules, which events they match, their text + tests
    usePhonePush.ts                   this phone's push subscription and the service worker
    segments.ts                       walking / stay / vehicle / underground, and what's happening now
    segments.test.ts                  node --test
    matching.ts                       which walks to snap for Snap to paths
    snap.ts                           keeps the matched line where the fixes lie along it + tests
    parks.ts                          parks from the map's tiles, and whether a point is in one + tests
    useSnappedWalks.ts                asks the server to snap walks, caches the results
    credits.ts                        the map's credits as text and http(s) links + tests
    mapStyles.ts                      the map styles to choose between, Auto + tests
    useMyPosition.ts                  your position from the browser (geolocation), while on
    useAddress.ts                     the selected asset's address, asked again after 25 m
    tracker.ts                        TrackerDetails type, signal labels
    share.ts                          share messages, times, the SharedView type
    shareSheet.ts                     share sheet, or copy as the fallback
    liveLinks.ts                      live links made in this browser (localStorage)
    useSharedAsset.ts                 a live link page's EventSource
    settings.ts                       per-browser settings (localStorage)
    platform.ts                       iOS or Material from a User-Agent
    assetImage.ts                     crop + shrink photos (browser), sniff image type (server)
    editErrors.ts                     messages for failed asset changes
    useLiveAssets.ts                  EventSource + trails + reconnect logic, and whether a newer build is serving
    buildId.ts                        this build's ID, from Vite
```

- `*.server.ts` files are server-only; TanStack Start's import protection fails the build if browser code imports them.
- `*.functions.ts` files hold server functions. Browser code can import these; their bodies become RPC calls.
- Server functions are protected against cross-site calls by TanStack Start's built-in CSRF check. If `src/start.ts` is ever added, it must register `createCsrfMiddleware` itself.

## Configuration

| Env var | Required | Purpose |
|---|---|---|
| `TRACCAR_URL` | yes | Traccar base URL as this app's server reaches it; can be an internal Docker address |
| `TRACCAR_PUBLIC_URL` | no | Where browsers reach Traccar's UI, for email-link redirects; default `TRACCAR_URL` |
| `SESSION_SECRET` | yes | ≥ 32 chars; encrypts the session cookie |
| `SESSION_DAYS` | no | Token and cookie lifetime, default `30` |
| `MAP_STYLE_URL` | no | maplibre style, default OpenFreeMap `bright` |
| `MAP_EXTRA_ORIGINS` | no | Comma-separated extra origins the map style loads from (CSP) |
| `MAP_MATCHING_URL` | no | Valhalla for Snap to paths, e.g. `http://valhalla:8002`; see [Snap to paths](#snap-to-paths-map-matching) |
| `SIGN_IN_METHODS` | no | `sso`, `password` or `sso,password` (default): how people may sign in; see [Which methods](#which-methods) |
| `TRACCAR_EVENTS_SECRET` | no | What Traccar sends with forwarded events, for [alerts](#alerts); without it, alerts aren't offered |
| `PORT`, `HOST` | no | Production server listen address, default `3000` on all interfaces |

There is no Traccar token in env: each user's own sign-in is the only way to reach Traccar data. `.env` is gitignored and `.env.example` is committed. No env var uses the `VITE_` prefix, so nothing server-side can land in the client bundle.

## Security

- The app calls only the Traccar endpoints listed here; there's no `/api/*` pass-through. The catch-all only redirects the browser and never proxies.
- **Live location links** are the only way to see data without signing in; see [Sharing](#sharing).
- **`/hooks/traccar-events`** is the only route Traccar calls. It takes events only with the shared secret, sends nothing back, and only ever pushes to known push services; see [Alerts](#alerts).
- `/live` needs the session cookie. It's a same-origin GET with `SameSite=Lax`, so other sites can't open it with your cookie. Traccar only accepts the token as a URL parameter on its socket, which may put the token in Traccar's access logs. That's server to server and never visible to the browser.
- **Content-Security-Policy** (production only; Vite's dev server needs inline scripts):
  - `script-src 'self' 'nonce-…'`: TanStack Start writes a few inline scripts into every page (hydration data, scroll restoration). `security.server.ts` makes a random nonce per request, and `getRouter` passes it to `ssr.nonce` so every one of those scripts carries it. No `'unsafe-inline'`.
  - `style-src 'self'`: CSS is only loaded from files. maplibre's inline styles are set from JavaScript, which CSP allows. So are React `style` props on elements that only render in the browser (the place picker, the bottom bar's fade), but not on anything the server renders: those become `style="…"` attributes in the HTML, which CSP blocks. The dev server sends no CSP, so it doesn't show; the front page's cutouts came out black in production that way. Server-rendered SVG uses presentation attributes (`fill="…"`) and classes instead.
  - `connect-src` / `img-src`: `'self'` plus the map style's origin and `MAP_EXTRA_ORIGINS`; `img-src` also allows `data:` and `blob:` for the map.
  - `worker-src 'self'`: the maplibre worker is served from the app's own origin, so no `blob:` is needed.
  - `object-src 'none'`, `base-uri 'none'`, `form-action 'self'`, `frame-ancestors 'none'`.
  - Checked in a production build: map, worker, trail and live stream all load with no violations.
- **Other headers** (dev and production): `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin` (the tile server never sees app URLs), `Cross-Origin-Opener-Policy: same-origin`, a `Permissions-Policy` turning off camera, microphone and payment, and allowing geolocation only for the site itself (for [your position](#ui) on the map), and `X-Robots-Tag: noindex, nofollow`. HSTS belongs on the HTTPS proxy.
- **`src/start.ts` and CSRF:** having a `start.ts` switches off TanStack Start's default CSRF protection for server functions, so it's registered there explicitly. Checked in production: cross-site calls get 403. Behind an HTTPS proxy it still works, because modern browsers send `Sec-Fetch-Site`, which is checked before `Origin`.
- No analytics or third-party scripts.
- **Traccar `:latest` moves.** `traccar.ts` checks the fields it reads and fails loudly instead of rendering nonsense. I'd recommend pinning the Traccar image tag in your deployment.

## Dependencies

- **Runtime:** `react`, `react-dom`, `@tanstack/react-start`, `@tanstack/react-router`, `maplibre-gl`, `konsta` (UI components; brings `tailwind-merge`), `srvx` (production HTTP server; already part of TanStack Start, so no extra code).
- **Dev:** `vite`, `@vitejs/plugin-react`, `tailwindcss` and `@tailwindcss/vite` (build-time CSS for Konsta and the app), `typescript`, plus `@types/react`, `@types/react-dom`, `@types/node` (type definitions only).
- **Node:** 24 LTS, pinned in `mise.toml`.
- **Deliberately not added:** auth library, state library, date library, animation library, `ws`, zod, `pmtiles`.

## Deployment

- **Build:** `vite build` bundles the server together with all its dependencies (`ssr.noExternal`, builds only) into `dist/server` (about 1 MB), and the browser files into `dist/client`.
- **Server:** `server.mjs` runs `srvx`. It serves `dist/client`, with year-long immutable caching for hashed `/assets/`, and hands everything else to the Start handler. `npm start` runs it locally, reading `.env`.
- **Docker image:** runs as the non-root `node` user and contains only `dist`, `server.mjs`, `package.json` and `srvx`: about 3 MB on top of `node:24-alpine`.
  - Built and tested with Podman 6.1 (rootless): 172 MB image, of which 3.3 MB is the app. It contains no `.env`.
    - Against a fake Traccar: password sign-in, SSO, map, live stream and trail all work, with no CSP violations.
    - Against the real Traccar: it reaches the server and shows the SSO button.
  - On stop, srvx waits 5 s for open connections, then closes the live streams and exits with code 0. That's within the default 10 s stop timeout, and browsers reconnect by themselves.
- **Hosting:** the image runs next to Traccar on its own subdomain, behind an HTTPS reverse proxy (HTTPS is needed for the `Secure` cookie and for OIDC). See the README for a compose service and a Caddy example.
- **Private Traccar:** `TRACCAR_URL` can be Traccar's internal address, so only panopticon needs to be reachable. Traccar's device port must stay reachable for the trackers.
