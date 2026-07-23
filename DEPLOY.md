# Deploy Kinweave to a public link

To send someone a link, Kinweave needs a public **HTTPS** URL (your laptop/Wi-Fi
address only works for people on the same network). Hosting also unlocks
**Add-to-Home-Screen install** and offline. It's one small always-on web service:
the app + the untrusted relay + the Claude proxy, all in `server/index.ts`. It
reads `PORT` from the host and binds `0.0.0.0`, so most hosts run it as-is.

## Choose the AI (onboarding chat)

The AI only builds each user's Persona from a chat — the relay stays P2P and never
sees it. Three ways to power it (any/all):

- **Host default (one key for everyone).** Set on the host:
  - `LLM_PROVIDER` = `anthropic` | `openai` | `zai` | `moonshot` | `qwen`
  - `LLM_API_KEY` = that provider's key
  - `LLM_MODEL` (optional override), `LLM_BASE_URL` (optional override)
  - Shortcut: just set `ANTHROPIC_API_KEY` (= provider `anthropic`).
- **Bring your own key (per user).** Leave the host key unset (or let users
  override): in the app, **AI: … · change** → pick a provider and paste a key. It's
  stored on their device and sent only to your server for the call.
- **Claude subscription (no API key).** Those users use the
  [Claude connector](mcp/README.md) instead — their own Claude is the brain.

The one-click button below deploys with **Anthropic** as the default; switch
providers by changing the `LLM_*` env vars in the dashboard.

## Render (easiest, free)

One click — this reads `render.yaml`:

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/SpreitzerJacobGit/kinweave)

1. Click the button (sign in to Render, approve the repo).
2. When prompted, set env var **`ANTHROPIC_API_KEY`** (marked "sync: false" so Render asks).
3. **Apply** → you get `https://kinweave-xxxx.onrender.com`.

Manual alternative: Render → **New → Blueprint** → pick the repo; or **New → Web
Service** with build `npm ci && npm run build:web` and start `npx tsx server/index.ts`.

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
