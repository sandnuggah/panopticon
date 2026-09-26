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

**Choosing methods:** `SIGN_IN_METHODS` is `password`, `sso`, or both (the default). The login page only shows the methods that are on. SSO also needs OpenID set up in Traccar, and is hidden until it is. The server refuses a method that's off, so hiding its button isn't the only barrier: password sign-in answers "turned off", and `/auth/sso` and the OpenID callback send the browser back to the login page. With neither method available, the login page says so and names the setting to check.

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
  }
  ```
  Devices disabled in Traccar are left out.
- **Updates:** the `/live` server route opens a WebSocket to `TRACCAR_URL/api/socket?token=…` using Node's built-in WebSocket client. It turns Traccar's `devices` and `positions` messages into `LiveUpdate`s (`src/lib/live.ts`) and sends them to the browser as Server-Sent Events. Events, logs and Traccar's `{}` keepalives are dropped. Traccar sends the latest positions as soon as the socket connects.
  - Why SSE: it's plain HTTP (the Start server needs no WebSocket support), `EventSource` reconnects on its own, and the token stays on the server.
  - The stream sends a comment line every 25 s so proxies don't close it, and `retry: 5000` for reconnects. It also sends `X-Accel-Buffering: no` so nginx-style proxies don't buffer it.
  - When the browser disconnects, the upstream socket is closed too.
- **Applying updates** (`applyUpdates`): device updates change name, status and last contact. Position updates never move an asset backwards in time, and a position without battery keeps the last known value. An update for an unknown asset (added in Traccar) reloads the list; a disabled one is removed.
- **When things go wrong:**
  - The stream ends (Traccar closed the socket): the browser reconnects after 5 s, then reloads the list and trail history to fill the gap.
  - The stream is refused: `/live` can't tell from the socket why, so it checks the token with a REST call. If the token is dead it clears the session and returns 401, and the page goes to `/login`. Otherwise it returns 502; the page keeps what it has, shows "Offline, retrying" and retries with backoff (5 s doubling to 60 s).
- **Phones:** background tabs get suspended, so when the page becomes visible again it reloads the list and trail history and reopens the stream.
- **Live indicator:** "Live", "Connecting…" or "Offline, retrying", as a pill floating over the map's top-left corner (zoom controls are top-right), so a still map isn't mistaken for a still asset.
- **Scale:** one upstream socket per open tab. At 1–5 assets and a handful of users that's fine.

## Trail

A line behind each asset showing where it went in the last N minutes, fading from transparent (oldest) to solid (newest).

- **History:** after the map loads, `getTrails({ minutes, assetIds })` calls `GET /api/positions?deviceId&from&to` once per asset. Positions Traccar marks invalid (no GPS fix, repeated old location) are left out.
  - Traccar refuses this endpoint for users with "disable reports" set. Those users just get no trail.
- **Live:** each valid live position is appended; points older than the window are dropped every 30 s.
- **Drawing:** one GeoJSON `LineString` per asset in a single maplibre line layer with `line-gradient` (needs `lineMetrics`). The colour is the theme's `--accent`, read once when the map loads.
- **Length:** set in Settings: Off, 5, 10 (default), 15, 30 or 60 minutes, or 3 hours. Longer means more history per asset on each load.

## Battery

SinoTrack trackers use Traccar's `h02` protocol. The ST-904L sends two kinds of message that matter here:

- **Heartbeats** (`HTBT`): Traccar reads a battery level from these and stores it as `batteryLevel`.
- **Location reports** (`V1`): the battery is there too, but Traccar doesn't know it. After the status field, the ST-904L sends extra values that Traccar stores unnamed as `io1`, `io2`, and so on:
  - `io1`–`io4` are cell info (MCC `240` = Sweden, MNC `01`, then area and cell IDs).
  - **`io5` is the battery percentage.** Confirmed on 2026-09-26: a heartbeat said 9% while `io5` on the report just before said 8%. It matches SinoTrack's 4G message layout and what Traccar forum users see on other SinoTrack models.
  - `io6` is most likely signal strength; `io7` and `io8` haven't changed.

**Mapping it in Traccar, not the app:** a computed attribute turns `io5` into `batteryLevel` on location reports, so every message has a battery level and other tracker models aren't affected.
- Settings → Computed attributes: Attribute **Battery Level**, which makes the type Number. Expression: `io5 != null && io5 * 1 >= 0 && io5 * 1 <= 100 ? io5 * 1 : null`. Linked to the tracker, or to its group.
- `io5 * 1` turns the text into a number without enabling `processing.computedAttributes.newInstanceCreation`. Traccar discards non-numbers for Number attributes; the attribute has to be Battery Level, or Traccar tries to store the result as the wrong type and drops it.
- Traccar runs these expressions strictly. On a heartbeat, which has no `io5`, the expression fails with a logged warning and the heartbeat's own battery level stays. If the expression returned null there instead, Traccar would remove the attribute.

In the app:
- `battery` is optional in the view model. The value comes from `batteryLevel` (percent) or `battery` (volts), whichever Traccar has.
- The card shows battery only when it exists. There's no placeholder.
- Live updates never blank a known battery value; a position without battery keeps the last one seen in that session.
- The value is the tracker's estimate from its voltage, so it moves with load and temperature: 8% → 12% → 19% while moving was seen on 2026-09-26. The gauge's bars absorb most of this.

## UI

- **Pages:** `/login`, `/`, `/settings`, and `/assets`, `/assets/new` and `/assets/<id>` for [managing assets](#managing-assets). The selected asset is a search param (`/?asset=12`), so it survives a reload.
- **App name:** the desktop sidebar starts with the app's name as the theme shows it ("Panopticon 👁️", or "Petopticon 🐾" in the pet theme). On phones that heading is hidden visually but kept for screen readers, so the compact list stays one row.
- **Settings link:** a round cog button (an 8-tooth gear, generated rather than hand-drawn so it's symmetric) at the end of the asset list: at the right end of the bottom bar on phones, at the bottom of the sidebar on desktop. The live indicator stays in the map's top-left corner. It's a plain link straight to Settings (`SettingsLink.tsx`); an earlier version opened a menu, which was one tap too many. Who's signed in is shown on the Settings page.
  - A profile picture was considered and dropped. Traccar has no user pictures, and the one Pocket ID sends at sign-in reaches only Traccar, which discards it. Getting it would need either a Pocket ID API key (which can't be scoped, so a full admin key) or a second OIDC client in panopticon.
- **Layout:** on phones (under 768 px), the map fills the screen and the assets form one compact row along the bottom: each is just its picture or initial, with a status dot on one bottom corner, a small battery gauge on the other (when the tracker reports one), and a ring when selected (about 74 px tall in all). The name and details stay in each button for screen readers but are hidden visually. From 768 px wide, the assets become full cards in a 22 rem side panel. The list never covers the map, so the map needs no padding tricks. Each full card shows:
  - the asset's picture from Traccar, or its initial if there's none or it fails to load (like the map marker);
  - the name, an online/offline dot and a status label;
  - "Seen 4 minutes ago", from `fixTime` using `Intl.RelativeTimeFormat` and re-rendered every 30 s;
  - "Last contact …" when there's no location, or contact is more than 5 minutes newer than the fix;
  - battery, when available: a gauge with 0–4 bars (empty below 5%, then one bar per started quarter) at the end of the name row, in the warning colour at 20% or below. The exact percentage is its label, for screen readers and as the hover tooltip. Readings near empty jump by several points as the voltage recovers, and bars hide most of that. Trackers that report volts only get a text line instead.
- **Map:** tapping a card selects that asset and flies to it; tapping the selected card again re-centres. Tapping a marker selects its asset. Tapping the selected asset's marker deselects it when it's centred (being followed, or within 12 px of the middle); when it's off-centre, for example after a drag, the tap re-centres it and resumes following instead. On load the map shows the asset in `?asset=`, or fits all assets.
- **Deselecting:** only by tapping the selected asset's marker while it's centred, or tapping the asset panel away from its cards and buttons (the gaps in the phone bar, the sidebar's title and empty space). Tapping or dragging the map keeps the selection.
- **Following:** while an asset is selected, the map keeps it centred, gliding to each new position (1 s).
  - **Dragging pauses it:** a mouse or one-finger drag, or panning with the arrow keys, stops following but keeps the asset selected. Tapping its card or its marker again, or selecting another asset, resumes. The pause is tied to the selection it was made in (`focusToken`), so it never carries over to the next one.
  - **Zooming keeps following:** scroll wheel, pinch, +/− and double-tap. While following, wheel and pinch zoom around the centre instead of the cursor or fingers. After a zoom gesture (a double-tap zooms around the tap; a pinch drifts, which maplibre reports as a two-finger drag and is ignored) the map glides back to the asset.
  - Position updates that arrive during a selection flight or a zoom gesture don't interrupt it; the map catches up when it ends. Those waits only apply while the map is actually moving, so a missed end event can't stop following.
  - Only real gestures pause following: maplibre fires `dragstart` for user drags, never for the app's own camera moves.
- **Markers:** maplibre DOM markers (enough for ≤5): a dot with the asset's initial and a name label. Greyed out when the fix is older than 30 minutes; a ring when selected (same size, so selecting doesn't shift it).
  - No accuracy circle yet: the ST-904L reports no accuracy, so it would never show. Add it when a tracker does.
- **Rendering:** maplibre runs in the browser only, lazy-loaded in a client-only component. The server-rendered HTML shows the asset list first, and maplibre stays out of the first-load bundle.
- **maplibre worker:** v6 looks for its worker script next to its own file, which breaks once bundled. Vite bundles it instead (`?worker&url`, `worker.format: 'es'`), and `setWorkerUrl` points maplibre at the same-origin result.
- **Data freshness:** the `/` loader reloads when you arrive on the map (`shouldReload: cause !== 'stay'`), not when you select an asset. Live updates keep it current in between.
- **Settings** (`/settings`): theme, trail length, a link to manage assets, and the account section with sign-out. Settings live in `localStorage`, per browser. They're a convenience: without storage, the defaults apply. Server render and hydration use the defaults, so the page waits for the stored value before fetching trail history.
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

Settings → Manage assets lists every device the user can see, including ones disabled in Traccar. From there you can add an asset (name and tracker ID), and on each asset's page change its photo, rename it or remove it. Only these three fields are handled; groups, phone numbers, models and categories stay in Traccar's UI.

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

## Themes

Pick a theme on the Settings page, from a list with a colour preview for each. Two themes so far:
- **Classic** (default): the original look, following the device's light or dark mode.
- **Petopticon** (theme id `pet`; formerly "Dog park" with id `dog`, which is still read as `pet` so saved choices carry over): renames the app to "Petopticon" on the login page and browser tab, and follows the device's light or dark mode (a pastel light palette, and a dark one with deep warm backgrounds and the same pastel accents), with a 🐾 after the login title, a gently softened map, and trails drawn as paw prints.

- **Storage:** the choice lives in the `panopticon-theme` cookie (one year, `SameSite=Lax`, `Secure` over HTTPS), per browser.
  - A cookie rather than `localStorage`, so the server can render `<html data-theme>` straight away: no flash of the default theme on load.
  - The root route's `beforeLoad` reads it on the server (`theme.server.ts`) or from `document.cookie` in the browser. `useTheme` keeps `<html>` in step when it changes. Unknown values fall back to Classic.
- **Styling:** each theme is a set of CSS variables in `styles.css`, keyed on `:root[data-theme='…']`, which outranks the default and dark-mode rules.
  - The CSP forbids inline `style` attributes, so everything theme-specific is done with classes, including the picker's colour previews.
  - `--trail` is the trail colour. The map reads it via `getComputedStyle`, because map paint properties can't use CSS variables.
- **Paw prints** (`AssetMap.tsx`):
  - The icon is a staggered left-and-right pair, drawn on a canvas in the theme's `--trail` colour, so there's no image file.
  - maplibre places the icons along each trail (`symbol-placement: line`, every 44 px) and turns them to face the direction of travel.
  - A symbol layer can't fade along a line the way `line-gradient` does, so each trail is split into up to five pieces with rising opacity.
  - The line and paw layers both exist; the theme decides which is visible, so switching themes needs no reload.
- **Adding a theme:**
  1. Add an entry to `THEMES` in `src/lib/theme.ts`.
  2. Add a `:root[data-theme='<id>']` block of variables, plus `.theme-preview-<id>` swatches, to `styles.css`.
  3. Optionally, give it special map behaviour in `AssetMap`, as the pet theme's paws do.

## Map tiles

- `MAP_STYLE_URL` is optional. The default is OpenFreeMap's `liberty` style: free, no API key, no analytics. OpenFreeMap does see which map areas you load.
- To use no third-party service, run your own tile server and point `MAP_STYLE_URL` at its style JSON. For example: `pmtiles serve` with a Protomaps extract, or Martin. This needs no app code changes and adds no dependency.
- The Content-Security-Policy allows the origin of `MAP_STYLE_URL` for tiles, fonts and sprites.

## Project layout

```
server.mjs                            production server: srvx + static files + Start handler
Dockerfile, .dockerignore
public/                               manifest + icons, copied to dist/client
src/
  start.ts                            request middleware: CSRF for server functions, security headers
  router.tsx                          also sets the per-request CSP nonce for Start's inline scripts
  routes/
    __root.tsx
    login.tsx
    index.tsx                         map + asset sheet (protected)
    auth.sso.ts                       server route: start SSO
    images.asset.$id.ts               server route: asset picture
    api.session.openid.callback.ts    server route: SSO return (path fixed by Traccar)
    settings.tsx                      theme, trail length, manage assets link, sign-out
    assets.index.tsx                  list of assets to manage
    assets.new.tsx                    add an asset
    assets.$id.tsx                    photo, name, remove
    live.ts                           server route: SSE relay
    $.ts                              Traccar email links → 302 to Traccar; else 404
  server/
    env.server.ts                     read + validate env once
    traccar.server.ts                 typed fetch client for the endpoints above
    session.server.ts                 sealed cookie, token exchange, withToken()
    assets.server.ts                  Traccar → Asset mapping
    auth.functions.ts                 getUser / loginWithPassword / logout
    assets.functions.ts               getAssets
    manage.server.ts                  add / rename / remove assets and photos; edit access; error mapping
    manage.functions.ts               server functions for the /assets pages, with input checks
    map.functions.ts                  getMapStyleUrl
    images.server.ts                  /images/asset/<id>: device pictures from Traccar, cached
    theme.server.ts                   theme from the request's cookie
    trails.functions.ts               getTrails (position history)
    security.server.ts                CSP nonce + security headers
    live.server.ts                    /live: WebSocket → SSE relay
    sso.server.ts                     /auth/sso, callback, Traccar email-link redirects
  components/
    AssetMap.tsx                      maplibre map + markers (browser only, lazy)
    AssetSheet.tsx                    asset cards
    AssetAvatar.tsx                   picture, or initial as the fallback
    LiveIndicator.tsx                 Live / Connecting / Offline
    SettingsLink.tsx                  cog link to Settings, at the end of the asset list
    RelativeTime.tsx
  lib/
    asset.ts                          Asset view model + isStale (shared with the browser)
    useNow.ts                         ticking clock for relative times
    live.ts                           LiveUpdate type + applyUpdates (shared with the server)
    trail.ts                          trail types, extend/prune
    settings.ts                       per-browser settings (localStorage)
    theme.ts                          THEMES, useTheme (cookie)
    assetImage.ts                     crop + shrink photos (browser), sniff image type (server)
    editErrors.ts                     messages for failed asset changes
    useLiveAssets.ts                  EventSource + trails + reconnect logic
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
| `SIGN_IN_METHODS` | no | `password`, `sso`, or both comma-separated (default both); see [Authentication](#authentication) |
| `MAP_STYLE_URL` | no | maplibre style, default OpenFreeMap `liberty` |
| `MAP_EXTRA_ORIGINS` | no | Comma-separated extra origins the map style loads from (CSP) |
| `PORT`, `HOST` | no | Production server listen address, default `3000` on all interfaces |

There is no Traccar token in env: each user's own sign-in is the only way to reach Traccar data. `.env` is gitignored and `.env.example` is committed. No env var uses the `VITE_` prefix, so nothing server-side can land in the client bundle.

## Security

- The app calls only the Traccar endpoints listed here; there's no `/api/*` pass-through. The catch-all only redirects the browser and never proxies.
- `/live` needs the session cookie. It's a same-origin GET with `SameSite=Lax`, so other sites can't open it with your cookie. Traccar only accepts the token as a URL parameter on its socket, which may put the token in Traccar's access logs. That's server to server and never visible to the browser.
- **Content-Security-Policy** (production only; Vite's dev server needs inline scripts):
  - `script-src 'self' 'nonce-…'`: TanStack Start writes a few inline scripts into every page (hydration data, scroll restoration). `security.server.ts` makes a random nonce per request, and `getRouter` passes it to `ssr.nonce` so every one of those scripts carries it. No `'unsafe-inline'`.
  - `style-src 'self'`: CSS is only loaded from files. maplibre's inline styles are set from JavaScript, which CSP allows.
  - `connect-src` / `img-src`: `'self'` plus the map style's origin and `MAP_EXTRA_ORIGINS`; `img-src` also allows `data:` and `blob:` for the map.
  - `worker-src 'self'`: the maplibre worker is served from the app's own origin, so no `blob:` is needed.
  - `object-src 'none'`, `base-uri 'none'`, `form-action 'self'`, `frame-ancestors 'none'`.
  - Checked in a production build: map, worker, trail and live stream all load with no violations.
- **Other headers** (dev and production): `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin` (the tile server never sees app URLs), `Cross-Origin-Opener-Policy: same-origin`, and a `Permissions-Policy` turning off camera, microphone, geolocation and payment. HSTS belongs on the HTTPS proxy.
- **`src/start.ts` and CSRF:** having a `start.ts` switches off TanStack Start's default CSRF protection for server functions, so it's registered there explicitly. Checked in production: cross-site calls get 403. Behind an HTTPS proxy it still works, because modern browsers send `Sec-Fetch-Site`, which is checked before `Origin`.
- No analytics or third-party scripts.
- **Traccar `:latest` moves.** `traccar.ts` checks the fields it reads and fails loudly instead of rendering nonsense. I'd recommend pinning the Traccar image tag in your deployment.

## Dependencies

- **Runtime:** `react`, `react-dom`, `@tanstack/react-start`, `@tanstack/react-router`, `maplibre-gl`, `srvx` (production HTTP server; already part of TanStack Start, so no extra code).
- **Dev:** `vite`, `@vitejs/plugin-react`, `typescript`, plus `@types/react`, `@types/react-dom`, `@types/node` (type definitions only).
- **Node:** 24 LTS, pinned in `mise.toml`.
- **Deliberately not added:** auth library, state library, date library, CSS framework, `ws`, zod, `pmtiles`.

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

## Build order

1. ✅ **Setup and a test against your server.** *Confirmed on the real server 2026-09-25.* `git init` with `.gitignore` (before `.env` exists), `.env.example`, env validation and the Traccar client. Then: password login → token exchange → `getAssets()` against your server, and print one real position's attributes (protocol, battery fields).
2. ✅ **Map and asset cards** from the first load. *Meets "done when". Confirmed on the real server 2026-09-25.*
3. ✅ **Live updates** over SSE, plus the **trail** and the **settings** page. *Tested against a fake Traccar; committed 2026-09-25 at your request before a full real-server check.*
4. ✅ **SSO**, including the catch-all redirect and the Traccar config change. *Confirmed with Pocket ID on the real server 2026-09-25.*
5. ✅ **Polish:** manifest, CSP, production server, Dockerfile. *Built and tested; the container image was run with Podman against the fake and the real Traccar.*
