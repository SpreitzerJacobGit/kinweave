# Deploy Kinweave to a public link

To send someone a link, Kinweave needs a public **HTTPS** URL (your laptop/Wi-Fi
address only works for people on the same network). Hosting also unlocks
**Add-to-Home-Screen install** and offline. It's one small always-on web service:
the app + the untrusted relay + the Claude proxy, all in `server/index.ts`. It
reads `PORT` from the host and binds `0.0.0.0`, so most hosts run it as-is.

Set **`ANTHROPIC_API_KEY`** in the host's env for the Claude onboarding chat
(without it, onboarding falls back to a quick form). That key is used only for
new users' onboarding — the relay stays peer-to-peer and never sees plaintext.

## Render (easiest, free)

1. Push this repo to GitHub (already at github.com/SpreitzerJacobGit/kinweave).
2. Render → **New → Blueprint** → pick the repo. It reads `render.yaml`.
   (Or **New → Web Service**, build `npm ci && npm run build:web`, start `npx tsx server/index.ts`.)
3. Add env var `ANTHROPIC_API_KEY`.
4. Deploy → you get `https://kinweave-xxxx.onrender.com`.

## Fly.io

```
flyctl launch --dockerfile Dockerfile --now
flyctl secrets set ANTHROPIC_API_KEY=sk-ant-...
```

## Any Docker host (Railway, a VPS, etc.)

```
docker build -t kinweave .
docker run -p 8788:8788 -e ANTHROPIC_API_KEY=sk-ant-... kinweave
```
Put it behind HTTPS (the platform's proxy, or Caddy/nginx). WebSockets must be
allowed to pass through on `/relay` (they are on Render/Fly/Railway by default).

## Then: the link you send

- **Get the app:** share `https://<your-host>/` — anyone opens it, builds a
  Persona, and can install it.
- **Invite to connect:** in the app tap **Connect / invite someone → Send invite
  link**. That link (`https://<your-host>/#pair=…`) is safe to text — the person
  opens it, builds a Persona if they're new, and your Personas connect. It works
  even if you open it at different times (the relay stores the message until you're
  both online).

## MCP connector users

If you're using the [Claude connector](mcp/README.md) instead of the web app,
point `KINWEAVE_RELAY` at your deployed relay: `wss://<your-host>/relay`. Then
subscription-only people and web-app people all meet on the same relay.
