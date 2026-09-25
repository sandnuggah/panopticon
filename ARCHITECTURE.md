# tracpet architecture

Phone-friendly web UI for a self-hosted Traccar server, tracking 1–5 pets.
Replaces Traccar's own UI for daily use; Traccar's UI stays available for admin work.

- **Must:** SSO and password sign-in, live map, last-seen time, battery level (when the tracker reports it, see [Battery](#battery)).
- **Won't:** user management, reports, multi-vehicle features.
- **Rules:** no secrets in git, no external analytics, minimal dependencies.
- **Done when:** you can sign in to your Traccar server and see your pets on a map.

Target: Traccar `:latest`, which is **v6.15.3** (released 2026-08-26). Every Traccar behavior below was checked against that version's source.

## Overview

The TanStack Start server sits between the browser and Traccar. The browser only talks to the app's own origin; only the server talks to Traccar. The Traccar URL and user tokens never reach the browser, there's no CORS setup, and the only Traccar endpoints reachable through the app are the few listed here.

```
phone                          TanStack Start server               Traccar
map + pet list   ── server fn ──▶ login / logout / getPets  ──REST──▶ /api/*
EventSource      ◀──── SSE ───── /live relay            ◀── WS ──── /api/socket?token=
SSO button       ──────────────▶ /auth/sso, OIDC callback ─────────▶ OpenID
email links      ──────────────▶ catch-all 302 ───────────────────▶ Traccar UI
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
   - rejects the request if `state` doesn't match the saved one (Traccar sends a `state` but never checks it);
   - forwards the query string to Traccar's callback;
   - takes the `JSESSIONID` from the response and runs the token exchange above;
   - redirects to `/`.

The login page reads the public `GET /api/server` endpoint and shows the SSO button when `openIdEnabled` is true. The password form is always shown.

### Traccar config changes

```xml
<entry key='web.url'>https://pets.example.com</entry>
<!-- openid.force must be absent or false, or password login stops working -->
```

In your identity provider, change the allowed redirect URI to `https://pets.example.com/api/session/openid/callback`.

Consequences of pointing `web.url` at this app:

- **SSO in Traccar's own UI stops working.** Password login there is unaffected.
- **Traccar's emails build their links from `web.url`.** These are `/event/:id`, `/settings/notifications?token=…`, `/reset-password?passwordReset=…`, report links and `/api/media/…`. The app therefore has a catch-all route: any path it doesn't own gets a 302 to `TRACCAR_URL` with the same path and query. Email links keep opening Traccar's UI.

### Session protection

- Protected routes check the session in `beforeLoad` and redirect to `/login`.
- Server functions are POST-only and the cookie is `SameSite=Lax`, which protects against cross-site request forgery.
- Server-side calls to Traccar send no `Origin` header, which Traccar's session origin check accepts.

## Live data

- **First load:** the `/` route loader calls `getPets()`, which calls `GET /api/devices` and `GET /api/positions` (latest position per device). They are merged into a view model; the browser never gets raw Traccar objects:
  ```ts
  type Pet = {
    id: number; name: string; status: 'online' | 'offline' | 'unknown'
    lastUpdate: string | null   // last contact from the tracker
    location: { lat: number; lon: number; accuracy?: number; fixTime: string } | null  // null until the first fix
    battery?: { percent?: number; volts?: number }
  }
  ```
  Devices disabled in Traccar are left out.
- **Updates:** the `/live` server route opens a WebSocket to `TRACCAR_URL/api/socket?token=…` using Node's built-in WebSocket client. It passes only the `devices` and `positions` messages on to the browser as Server-Sent Events. Traccar sends the latest positions as soon as the socket connects.
  - Why SSE: it's plain HTTP (the Start server needs no WebSocket support), `EventSource` reconnects on its own, and the token stays on the server.
- **Phones:** background tabs get suspended, so when the page becomes visible again it reruns `getPets()` and reopens the stream.
- **Scale:** one upstream socket per open tab. At 1–5 pets and a handful of users that's fine.

## Battery

SinoTrack trackers use Traccar's `h02` protocol. In 6.15.3's `H02ProtocolDecoder`, battery is only recorded from heartbeat (`HTBT`), `LINK`, `V3` and binary messages. The regular text location message has an optional battery field, but Traccar's decoder skips it. So the ST-904L most likely gives Traccar no battery data, which matches what you've seen.

- `battery` is optional in the view model. The value comes from `batteryLevel` (percent) or `battery` (volts), whichever Traccar has.
- The card shows battery only when it exists. There's no placeholder.
- Live updates never blank a known battery value; a position without battery keeps the last one seen in that session.

**Confirmed from real data (2026-09-25):** the ST-904L reports protocol `h02` with no `batteryLevel` or `battery`. It does send eight extra values after the status field, which Traccar stores unnamed as `io1`–`io8`:

- `io1`–`io4` look like cell info (MCC `240` = Sweden, MNC `01`, then area and cell IDs).
- On SinoTrack 4G models, `io5` is reported to be battery %. It read `0` on a tracker that had gone offline, which is consistent with an empty battery but not proof.

**Plan:** map it in Traccar, not in the app. A computed attribute `batteryLevel` = `io5` (as a number), linked to the SinoTrack devices, makes Traccar store a real battery level. The app then shows it with no code change, and other tracker models aren't affected. Confirm `io5` is battery first: charge the tracker and check that `io5` rises.

## UI

- **Pages:** `/login` and `/`. The selected pet is a search param (`/?pet=12`), so it survives a reload.
- **Layout:** full-screen map with a bottom sheet of pet cards. Each card shows:
  - the name;
  - an online/offline dot;
  - "seen 4 min ago", from `fixTime` using `Intl.RelativeTimeFormat` and re-rendered every 30 s;
  - "last contact …" when it differs from the fix time by more than a few minutes;
  - battery, when available.
- **Map:** tap a card to fly to that pet. On load the map fits all pets.
- **Markers:** maplibre DOM markers (enough for ≤5), greyed out when the fix is stale, with an accuracy circle when the position reports accuracy.
- **Rendering:** maplibre runs in the browser only, lazy-loaded in a client-only component. The server-rendered HTML shows the pet list first.
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
    index.tsx                         map + pet sheet (protected)
    auth.sso.ts                       server route: start SSO                        (step 4)
    api.session.openid.callback.ts    server route: SSO return (path fixed by Traccar) (step 4)
    live.ts                           server route: SSE relay                        (step 3)
    $.ts                              catch-all: 302 to TRACCAR_URL + same path       (step 4)
  server/
    env.server.ts                     read + validate env once
    traccar.server.ts                 typed fetch client for the endpoints above
    session.server.ts                 sealed cookie, token exchange, withToken()
    pets.server.ts                    Traccar → Pet mapping
    auth.functions.ts                 getUser / loginWithPassword / logout
    pets.functions.ts                 getPets
  components/
    RelativeTime.tsx  PetMap.tsx (step 2)  PetSheet.tsx (step 2)
  lib/
    pet.ts                            Pet view model (shared with the browser)
    live.ts                           EventSource → store (useSyncExternalStore)  (step 3)
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
- **Content-Security-Policy:**
  - `default-src 'self'`
  - `connect-src` / `img-src`: `'self'` plus the map origin
  - `worker-src blob:` (needed by maplibre)
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

1. ✅ **Setup and a test against your server.** *Confirmed on the real server 2026-09-25.* `git init` with `.gitignore` (before `.env` exists), `.env.example`, env validation and the Traccar client. Then: password login → token exchange → `getPets()` against your server, and print one real position's attributes (protocol, battery fields).
2. **Map and pet cards** from the first load. *Meets "done when".*
3. **Live updates** over SSE.
4. **SSO**, including the catch-all redirect and the Traccar config change.
5. **Polish:** manifest, CSP, Dockerfile.
