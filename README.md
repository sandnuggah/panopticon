# panopticon

A phone-friendly web app for a self-hosted [Traccar](https://www.traccar.org) server: a live map of a
few tracked assets (pets, bikes, bags…) with last-seen times, battery, a trail of recent
movement, and places like Home that show when an asset arrived and left. Sign in with your Traccar password or through Traccar's single sign-on.

The browser only talks to panopticon; only panopticon's server talks to Traccar. See
[ARCHITECTURE.md](ARCHITECTURE.md) for how it works and why.

## Develop

Needs Node 24 (pinned in `mise.toml`).

```bash
cp .env.example .env   # then set TRACCAR_URL and SESSION_SECRET
npm install
npm run dev            # http://localhost:3000
```

`npm run typecheck` checks types; `npm run build && npm start` runs the production build locally.

No Traccar to hand? `node dev/mock-traccar.mjs` runs a stand-in with three made-up assets and two places on port 8082 (Betty goes for a walk on real streets on Södermalm every three hours, and starts just home from one; `HOME_SINCE=-6` starts it six minutes before she's back). Put
`TRACCAR_URL=http://127.0.0.1:8082` in `.env.development.local` and sign in as `pet@example.com` / `secret`.

## Configure

All configuration is environment variables; `.env.example` documents each one. The required ones:

- `TRACCAR_URL`: Traccar as panopticon's server reaches it. In Docker this can be the internal
  address (`http://traccar:8082`), so Traccar's web port doesn't need to be public.
- `SESSION_SECRET`: at least 32 random characters (`openssl rand -base64 32`).

Never commit `.env`; it's gitignored.

## Deploy with Docker

Build the image and push it to a registry, e.g. GitHub Container Registry. From your own machine,
after `podman login ghcr.io` with a token that has `write:packages`:

```bash
podman build --platform linux/amd64,linux/arm64 --manifest ghcr.io/<github-user>/panopticon:2 .
podman manifest push --all ghcr.io/<github-user>/panopticon:2
podman manifest push --all ghcr.io/<github-user>/panopticon:2 ghcr.io/<github-user>/panopticon:latest
```

The numbered tag lets you pin a release or roll back; `:latest` always points at the newest one.

This builds for both x86-64 servers and ARM. A plain `podman build` on an Apple
Silicon Mac makes an ARM-only image, which fails on x86 with `exec format error`. The app build runs
natively either way; see the Dockerfile.

New GHCR packages are private. Make the package public in its settings on GitHub, so the server can
pull without logging in. The image contains no secrets; all config comes from the environment.

On the server, [`deploy/`](deploy) holds a compose project that runs that image next to Traccar. It
joins Traccar's Docker network, so Traccar's web port doesn't need to be published. It also runs
with a read-only filesystem, no Linux capabilities and a healthcheck.

1. Copy `deploy/compose.yaml` and `deploy/.env.example` to a folder on the server.
2. Rename `.env.example` to `.env` and fill it in. `docker network ls` shows Traccar's network name.
3. Run:
   ```bash
   docker compose up -d
   ```
4. Check it:
   ```bash
   docker compose ps
   ```
   It should show `healthy` after about 10 seconds.

To update, push a new tag, change `PANOPTICON_IMAGE` in `.env`, and run `docker compose up -d` again.

Put it behind an HTTPS reverse proxy; the session cookie and single sign-on need HTTPS. With Caddy:

```
panopticon.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

The live map uses Server-Sent Events. Caddy passes them through as they arrive. With nginx, raise
`proxy_read_timeout` above 30 s. The app sends `X-Accel-Buffering: no`, so nginx won't buffer the
stream.

## Snap to paths (optional)

"Snap to paths" (Settings → Appearance) draws walks along the streets and
paths they most likely took, using [Valhalla](https://github.com/valhalla/valhalla), a routing engine
built from OpenStreetMap data that you run yourself. Trail points only go to it, never to a third
party. Without it the switch is greyed out.

1. Add Valhalla to `compose.yaml`, on the same network as panopticon:
   ```yaml
     valhalla:
       image: ghcr.io/valhalla/valhalla-scripted:latest   # pin a version tag once it works
       restart: unless-stopped
       environment:
         # OpenStreetMap data for the area you need, e.g. from https://download.geofabrik.de
         tile_urls: https://download.geofabrik.de/europe/sweden-latest.osm.pbf
         serve_tiles: "True"
         build_elevation: "False"
         build_time_zones: "False"
         build_admins: "False"
         build_transit: "False"
         server_threads: "2"
       volumes:
         - ./valhalla:/custom_files
       networks:
         - traccar
   ```
2. Start it and wait for the first build to finish; the log ends with "Tile extract successfully
   loaded". For Sweden this downloads about 780 MB and takes a while; restarts reuse the result.
   ```bash
   docker compose up -d valhalla
   ```
3. Set `MAP_MATCHING_URL=http://valhalla:8002` in `.env` and restart panopticon:
   ```bash
   docker compose up -d
   ```

To refresh the map data every few months, delete `./valhalla/valhalla_tiles.tar` and restart Valhalla.

## Alerts (optional)

Settings → Alerts sends notifications to a phone or computer when an asset leaves or arrives at one of its
places, or its tracker goes offline, also while Panopticon is closed. Traccar tells panopticon about
each event (event forwarding), and panopticon sends the notification with Web Push. Each device
chooses its own alerts, and they're kept with the assets in Traccar, so panopticon still stores
nothing. On iPhone and iPad they work in the Home Screen app (iOS 16.4 or later).

Panopticon has to be on HTTPS at a real domain name: browsers only allow push there, and Apple's
push service checks the address.

1. Make a secret for Traccar to send with its events:
   ```bash
   openssl rand -hex 24
   ```
2. Set it in panopticon's `.env` (next to `deploy/compose.yaml`) and restart panopticon with
   `docker compose up -d`:
   ```
   TRACCAR_EVENTS_SECRET=<the secret>
   ```
3. Add four lines to Traccar's `traccar.xml`, with panopticon's address as Traccar reaches it
   (in Docker, the service name), then restart Traccar:
   ```xml
   <entry key='event.status.enable'>true</entry>
   <entry key='event.forward.enable'>true</entry>
   <entry key='event.forward.url'>http://panopticon:3000/hooks/traccar-events</entry>
   <entry key='event.forward.header'>Authorization: Bearer <the secret></entry>
   ```
4. On the phone (from the Home Screen) or in a desktop browser: Settings → Alerts → **Turn on alerts on
   this device**, and choose which. **Send a test alert** checks the device's side.

`event.status.enable` makes Traccar record when a tracker goes offline (it doesn't by default since
version 6.14), for the offline alert. A tracker that just goes quiet, without hanging up, counts as
offline after Traccar's `status.timeout`, 10 minutes by default.

A walk along the edge of a place crosses it back and forth. After an alert about a place, its
crossings in the next 10 minutes wait: when the 10 minutes are up you hear once more, only if the asset ended up on
the other side.

Traccar forwards every event, not just these; panopticon ignores the rest. Alerts stay on for a
device until they're turned off there, also after signing out. Changing `SESSION_SECRET` turns
everyone's alerts off: turn them on again on each device.

## Street addresses (optional)

The selected asset's card shows its street address, from Traccar's own reverse geocoder. Recent
Traccar versions use LocationIQ by default, with a key shared by every install. To keep coordinates on
your own machines, run [Nominatim](https://nominatim.org) next to Traccar:

1. Add it to `compose.yaml`, on Traccar's network:
   ```yaml
     nominatim:
       image: mediagis/nominatim:5.3
       restart: unless-stopped
       shm_size: 1g
       environment:
         PBF_URL: https://download.geofabrik.de/europe/sweden-latest.osm.pbf
         IMPORT_STYLE: address        # streets and house numbers only
         REVERSE_ONLY: "true"         # coordinates to addresses, all Traccar needs
         FREEZE: "true"               # no live map updates, saves disk
         POSTGRES_SHARED_BUFFERS: 1GB
         POSTGRES_MAINTENANCE_WORK_MEM: 2GB
         POSTGRES_EFFECTIVE_CACHE_SIZE: 4GB
         NOMINATIM_PASSWORD: ${NOMINATIM_PASSWORD}
       volumes:
         - ./nominatim:/var/lib/postgresql/16/main
       networks:
         - traccar
   ```
2. Set `NOMINATIM_PASSWORD` in `.env` to a random string, start it, and wait for the import to finish:
   ```bash
   docker compose up -d nominatim
   ```
3. Point Traccar at it in `traccar.xml`, then restart Traccar:
   ```xml
   <entry key='geocoder.enable'>true</entry>
   <entry key='geocoder.type'>nominatim</entry>
   <entry key='geocoder.url'>http://nominatim:8080/reverse</entry>
   <entry key='geocoder.language'>sv</entry>
   <entry key='geocoder.format'>%r %h, %t</entry>
   <entry key='geocoder.ignorePositions'>true</entry>
   ```

Without a working geocoder the address line is simply not shown.

## Single sign-on

panopticon uses Traccar's own OpenID Connect setup. Once panopticon is reachable at its final address:

1. In `traccar.xml`, set `web.url` to panopticon's address, e.g. `https://panopticon.example.com`,
   and restart Traccar. Traccar builds the sign-in callback address from it.
2. In your identity provider, add `https://panopticon.example.com/api/session/openid/callback` to the
   Traccar client's callback URLs.

To offer only one way to sign in, set `SIGN_IN_METHODS=sso` (single sign-on only) or
`SIGN_IN_METHODS=password` in `.env`; the default offers both. The sign-in page shows only those,
and panopticon's server refuses the other.

Two side effects of step 1:
- SSO inside Traccar's own web UI stops working; password sign-in there still works.
- Links in Traccar's emails now point at panopticon, which forwards them to `TRACCAR_PUBLIC_URL`.

Keep `openid.force` off; it disables password sign-in for everyone, admins included.
ARCHITECTURE.md lists the Traccar OpenID quirks found while setting this up.
