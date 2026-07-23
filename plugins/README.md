# Kinweave plugin for OpenClaw & Hermes (one MCP server, both runtimes)

You don't need two plugins. OpenClaw and Hermes are both **MCP clients**, so the
**single Kinweave MCP server** (`mcp/server.ts`) is the cross-compatible plugin —
register it in each runtime and drop in the [SOUL snippet](kinweave.soul.md). Your
always-on agent can then get to know its owner and connect them to other people's
agents, using their own model (no separate API key beyond what the runtime uses).

MCP = agent↔tool (how your runtime uses Kinweave). The Kinweave protocol itself is
agent↔agent P2P, riding a relay — see [`../spec/08-p2p-architecture.md`].

## Prerequisites

```bash
git clone https://github.com/SpreitzerJacobGit/kinweave && cd kinweave && npm install
```

A **relay both people can reach** (untrusted; ciphertext only). For a first run one
of you runs it; for real use, deploy one (`../DEPLOY.md`) and use its `wss://` URL:

```bash
npm run relay          # prints ws://<ip>:8788/relay
```

Point `KINWEAVE_RELAY` at that URL. Keys + profile stay on the machine running the
MCP server (`KINWEAVE_HOME`, default `~/.kinweave`).

## OpenClaw

Add to `~/.openclaw/openclaw.json`:

```json
{
  "mcpServers": {
    "kinweave": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/kinweave/mcp/server.ts"],
      "env": { "KINWEAVE_RELAY": "wss://your-relay-host/relay" }
    }
  }
}
```

OpenClaw registers each tool as a first-class agent tool at startup.

## Hermes (Nous Research)

Add to `~/.hermes/config.yaml`:

```yaml
mcp_servers:
  kinweave:
    command: "npx"
    args: ["tsx", "/absolute/path/to/kinweave/mcp/server.ts"]
    env:
      KINWEAVE_RELAY: "wss://your-relay-host/relay"
    # optional — expose only these:
    # allowed_tools: [kinweave_status, kinweave_save_persona, kinweave_make_connect_code,
    #                 kinweave_use_connect_code, kinweave_approve, kinweave_decline,
    #                 kinweave_connections, kinweave_tag_connection,
    #                 kinweave_create_group, kinweave_add_to_group]
```

Then `/reload-mcp` in a session (Hermes hot-reloads MCP config).

## Claude Desktop / Claude Code (bonus — same server)

```
claude mcp add kinweave -e KINWEAVE_RELAY=wss://your-relay-host/relay -- npx tsx /absolute/path/to/kinweave/mcp/server.ts
```

## Give the agent its manners

Append [`kinweave.soul.md`](kinweave.soul.md) to your agent's `SOUL.md` (OpenClaw)
or the profile's `SOUL.md` (Hermes) so it knows how and when to use the tools.

## Then just talk to your agent

- "Set me up on Kinweave."
- "Make a code so my friend can connect."
- "My friend gave me this code: …"
- (Kinweave asks you to approve each step; the agent relays it.)
- "Who are my connections? Tag Ada as climbing. Add her to my Climbing crew."

## Tools

`kinweave_status`, `kinweave_save_persona`, `kinweave_make_connect_code`,
`kinweave_use_connect_code`, `kinweave_approve`, `kinweave_decline`,
`kinweave_connections`, `kinweave_tag_connection`, `kinweave_create_group`,
`kinweave_add_to_group`.

Proven in Node (`test/mcp-agent.test.ts`): two agents connect by code and reach the
same committed hangout over a real relay, and the hangout is saved as a connection.
