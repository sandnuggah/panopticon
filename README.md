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

Add a service next to Traccar in your compose file:

```yaml
services:
  panopticon:
    build: ../panopticon          # path to this repo
    restart: unless-stopped
    env_file: ../panopticon/.env  # or list the variables under `environment:`
    environment:
      TRACCAR_URL: http://traccar:8082
      TRACCAR_PUBLIC_URL: https://traccar.example.com   # only if Traccar's UI is reachable at all
    ports:
      - "127.0.0.1:3000:3000"     # only the reverse proxy should reach it
```

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
