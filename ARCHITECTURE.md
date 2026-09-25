# panopticon architecture

Phone-friendly web UI for a self-hosted Traccar server, tracking a handful (1–5) of assets: anything with a tracker on it, such as a pet.
Replaces Traccar's own UI for daily use; Traccar's UI stays available for admin work.

- **Must:** SSO and password sign-in, live map, last-seen time, battery level (when the tracker reports it, see [Battery](#battery)).
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
- **Header indicator:** "Live", "Connecting…" or "Offline, retrying", so a still map isn't mistaken for a still asset.
- **Scale:** one upstream socket per open tab. At 1–5 assets and a handful of users that's fine.

## Trail

A line behind each asset showing where it went in the last N minutes, fading from transparent (oldest) to solid (newest).

- **History:** after the map loads, `getTrails({ minutes, assetIds })` calls `GET /api/positions?deviceId&from&to` once per asset. Positions Traccar marks invalid (no GPS fix, repeated old location) are left out.
  - Traccar refuses this endpoint for users with "disable reports" set. Those users just get no trail.
- **Live:** each valid live position is appended; points older than the window are dropped every 30 s.
- **Drawing:** one GeoJSON `LineString` per asset in a single maplibre line layer with `line-gradient` (needs `lineMetrics`). The colour is the theme's `--accent`, read once when the map loads.
- **Length:** set in Settings: Off, 5, 10 (default), 15, 30 or 60 minutes, or 3 hours. Longer means more history per asset on each load.

## Battery

SinoTrack trackers use Traccar's `h02` protocol. In 6.15.3's `H02ProtocolDecoder`, battery is only recorded from heartbeat (`HTBT`), `LINK`, `V3` and binary messages. The regular text location message has an optional battery field, but Traccar's decoder skips it. So the ST-904L most likely gives Traccar no battery data, which matches what you've seen.

- `battery` is optional in the view model. The value comes from `batteryLevel` (percent) or `battery` (volts), whichever Traccar has.
- The card shows battery only when it exists. There's no placeholder.
- Live updates never blank a known battery value; a position without battery keeps the last one seen in that session.

**Confirmed from real data (2026-09-25):** the ST-904L reports protocol `h02` with no `batteryLevel` or `battery`. It does send eight extra values after the status field, which Traccar stores unnamed as `io1`–`io8`:

- `io1`–`io4` look like cell info (MCC `240` = Sweden, MNC `01`, then area and cell IDs).
- On SinoTrack 4G models, `io5` is reported to be battery %. It read `0` on a tracker that had gone offline, then `13` once it was back online the same day. That fits a recharged battery, but isn't proof yet. `io6` also changed (`16` → `26`); `io7` and `io8` stayed the same.

**Plan:** map it in Traccar, not in the app. A computed attribute `batteryLevel` = `io5` (as a number), linked to the SinoTrack devices, makes Traccar store a real battery level. The app then shows it with no code change, and other tracker models aren't affected. Confirm `io5` is battery first: charge the tracker and check that `io5` rises.

## UI

- **Pages:** `/login`, `/` and `/settings`. The selected asset is a search param (`/?asset=12`), so it survives a reload.
- **Layout:** on phones, the map fills the top and a sheet of asset cards sits below it (up to 45% of the screen, scrolls). From 768px wide, the cards move to a 22rem side panel. The sheet doesn't cover the map, so the map needs no padding tricks. Each card shows:
  - the name, an online/offline dot and a status label;
  - "Seen 4 minutes ago", from `fixTime` using `Intl.RelativeTimeFormat` and re-rendered every 30 s;
  - "Last contact …" when there's no location, or contact is more than 5 minutes newer than the fix;
  - battery, when available (highlighted at 20% or below).
- **Map:** tapping a card or marker selects that asset and flies to it; tapping it again re-centres. On load the map shows the asset in `?asset=`, or fits all assets.
- **Markers:** maplibre DOM markers (enough for ≤5): a dot with the asset's initial and a name label. Greyed out when the fix is older than 30 minutes; larger with a ring when selected.
  - No accuracy circle yet: the ST-904L reports no accuracy, so it would never show. Add it when a tracker does.
- **Rendering:** maplibre runs in the browser only, lazy-loaded in a client-only component. The server-rendered HTML shows the asset list first, and maplibre stays out of the first-load bundle.
- **maplibre worker:** v6 looks for its worker script next to its own file, which breaks once bundled. Vite bundles it instead (`?worker&url`, `worker.format: 'es'`), and `setWorkerUrl` points maplibre at the same-origin result.
- **Data freshness:** the `/` loader reloads when you arrive on the map (`shouldReload: cause !== 'stay'`), not when you select an asset. Live updates keep it current in between.
- **Settings** (`/settings`): trail length, plus the account section with sign-out. Settings live in `localStorage`, per browser. They're a convenience: without storage, the defaults apply. Server render and hydration use the defaults, so the page waits for the stored value before fetching trail history.
- **Home screen:** a web app manifest so the app can be added to the home screen. No service worker for now.

## Map tiles

- `MAP_STYLE_URL` is optional. The default is OpenFreeMap's `liberty` style: free, no API key, no analytics. OpenFreeMap does see which map areas you load.
- To use no third-party service, run your own tile server and point `MAP_STYLE_URL` at its style JSON. For example: `pmtiles serve` with a Protomaps extract, or Martin. This needs no app code changes and adds no dependency.
- The Content-Security-Policy allows the origin of `MAP_STYLE_URL` for tiles, fonts and sprites.

## Project layout

```
src/
  router.tsx
  routes/
    __root.tsx
    login.tsx
    index.tsx                         map + asset sheet (protected)
    auth.sso.ts                       server route: start SSO
    api.session.openid.callback.ts    server route: SSO return (path fixed by Traccar)
    settings.tsx                      trail length, sign-out
    live.ts                           server route: SSE relay
    $.ts                              Traccar email links → 302 to Traccar; else 404
  server/
    env.server.ts                     read + validate env once
    traccar.server.ts                 typed fetch client for the endpoints above
    session.server.ts                 sealed cookie, token exchange, withToken()
    assets.server.ts                  Traccar → Asset mapping
    auth.functions.ts                 getUser / loginWithPassword / logout
    assets.functions.ts               getAssets
    map.functions.ts                  getMapStyleUrl
    trails.functions.ts               getTrails (position history)
    live.server.ts                    /live: WebSocket → SSE relay
    sso.server.ts                     /auth/sso, callback, Traccar email-link redirects
  components/
    AssetMap.tsx                      maplibre map + markers (browser only, lazy)
    AssetSheet.tsx                    asset cards
    LiveIndicator.tsx                 Live / Connecting / Offline
    RelativeTime.tsx
  lib/
    asset.ts                          Asset view model + isStale (shared with the browser)
    useNow.ts                         ticking clock for relative times
    live.ts                           LiveUpdate type + applyUpdates (shared with the server)
    trail.ts                          trail types, extend/prune
    settings.ts                       per-browser settings (localStorage)
    useLiveAssets.ts                  EventSource + trails + reconnect logic
```

- `*.server.ts` files are server-only; TanStack Start's import protection fails the build if browser code imports them.
- `*.functions.ts` files hold server functions. Browser code can import these; their bodies become RPC calls.
- Server functions are protected against cross-site calls by TanStack Start's built-in CSRF check. If `src/start.ts` is ever added, it must register `createCsrfMiddleware` itself.

## Configuration

| Env var | Required | Purpose |
|---|---|---|
| `TRACCAR_URL` | yes | Traccar base URL, server-only |
| `SESSION_SECRET` | yes | ≥ 32 chars; encrypts the session cookie |
| `SESSION_DAYS` | no | Token and cookie lifetime, default `30` |
| `MAP_STYLE_URL` | no | maplibre style, default OpenFreeMap `liberty` |

There is no Traccar token in env: each user's own sign-in is the only way to reach Traccar data. `.env` is gitignored and `.env.example` is committed. No env var uses the `VITE_` prefix, so nothing server-side can land in the client bundle.

## Security

- The app calls only the Traccar endpoints listed here; there's no `/api/*` pass-through. The catch-all only redirects the browser and never proxies.
- `/live` needs the session cookie. It's a same-origin GET with `SameSite=Lax`, so other sites can't open it with your cookie. Traccar only accepts the token as a URL parameter on its socket, which may put the token in Traccar's access logs. That's server to server and never visible to the browser.
- **Content-Security-Policy:**
  - `default-src 'self'`
  - `connect-src` / `img-src`: `'self'` plus the map origin
  - `worker-src 'self'`: the maplibre worker is served from the app's own origin, so no `blob:` is needed
- No analytics or third-party scripts.
- **Traccar `:latest` moves.** `traccar.ts` checks the fields it reads and fails loudly instead of rendering nonsense. I'd recommend pinning the Traccar image tag in your deployment.

## Dependencies

- **Runtime:** `react`, `react-dom`, `@tanstack/react-start`, `@tanstack/react-router`, `maplibre-gl`.
- **Dev:** `vite`, `@vitejs/plugin-react`, `typescript`, plus `@types/react`, `@types/react-dom`, `@types/node` (type definitions only).
- **Node:** 24 LTS, pinned in `mise.toml`.
- **Deliberately not added:** auth library, state library, date library, CSS framework, `ws`, zod, `pmtiles`.

## Deployment

`vite build` produces a Node server, packaged as a small Docker image next to Traccar on its own subdomain. It needs HTTPS for the `Secure` cookie and for OIDC.

## Build order

1. ✅ **Setup and a test against your server.** *Confirmed on the real server 2026-09-25.* `git init` with `.gitignore` (before `.env` exists), `.env.example`, env validation and the Traccar client. Then: password login → token exchange → `getAssets()` against your server, and print one real position's attributes (protocol, battery fields).
2. ✅ **Map and asset cards** from the first load. *Meets "done when". Confirmed on the real server 2026-09-25.*
3. ✅ **Live updates** over SSE, plus the **trail** and the **settings** page. *Tested against a fake Traccar; committed 2026-09-25 at your request before a full real-server check.*
4. ✅ **SSO**, including the catch-all redirect and the Traccar config change. *Confirmed with Pocket ID on the real server 2026-09-25.*
5. **Polish:** manifest, CSP, Dockerfile.
