# panopticon

A phone-friendly web app for a self-hosted [Traccar](https://www.traccar.org) server: a live map of a
few tracked assets (pets, bikes, bags…) with last-seen times, battery, and a trail of recent
movement. Sign in with your Traccar password or through Traccar's single sign-on.

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
```

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

## Single sign-on

panopticon uses Traccar's own OpenID Connect setup. Once panopticon is reachable at its final address:

1. In `traccar.xml`, set `web.url` to panopticon's address, e.g. `https://panopticon.example.com`,
   and restart Traccar. Traccar builds the sign-in callback address from it.
2. In your identity provider, add `https://panopticon.example.com/api/session/openid/callback` to the
   Traccar client's callback URLs.

Two side effects of step 1:
- SSO inside Traccar's own web UI stops working; password sign-in there still works.
- Links in Traccar's emails now point at panopticon, which forwards them to `TRACCAR_PUBLIC_URL`.

Keep `openid.force` off; it disables password sign-in for everyone, admins included.
ARCHITECTURE.md lists the Traccar OpenID quirks found while setting this up.
