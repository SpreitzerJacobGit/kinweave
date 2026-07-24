# Kinweave inside Claude (MCP connector)

Use Kinweave with **just a Claude subscription — no Anthropic API key.** You add
Kinweave as a connector; your own Claude (Pro/Max, or Claude Code) becomes your
Persona's brain: it builds your profile from a normal chat, makes/uses connection
codes, and asks you to approve each disclosure and the final hangout. Your keys +
profile stay **on your machine** (`~/.kinweave/state.json`); the negotiation runs
on-device and reaches other people through a relay.

## What you need

1. **This repo** on your machine, deps installed (`npm install`).
2. **A relay both people can reach.** The relay only ever sees encrypted blobs.
   For a first try with a friend, one of you runs it and you both point at it:
   ```
   npm run relay          # prints a ws:// URL, e.g. ws://192.168.1.42:8788/relay
   ```
   (or `npm start`, which also runs the relay at `…:8788/relay`). Same Wi-Fi for
   a laptop relay; a cloud host for use-from-anywhere. Set `KINWEAVE_RELAY` to it.

## Add the connector

**Claude Code:**
```
claude mcp add kinweave -e KINWEAVE_RELAY=ws://192.168.1.42:8788/relay -- npx tsx C:/Kinweave/mcp/server.ts
```

**Claude Desktop** — edit `claude_desktop_config.json`
(Windows: `%APPDATA%\Claude\claude_desktop_config.json`, macOS:
`~/Library/Application Support/Claude/claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "kinweave": {
      "command": "npx",
      "args": ["tsx", "C:/Kinweave/mcp/server.ts"],
      "env": { "KINWEAVE_RELAY": "ws://192.168.1.42:8788/relay" }
    }
  }
}
```
Restart Claude Desktop. (`KINWEAVE_HOME` optionally sets where keys/profile live.)

## Use it — just talk to Claude

- **"Set me up on Kinweave."** Claude runs the guided interview from
  [`spec/11-persona-interview.md`](../spec/11-persona-interview.md) — a short, warm
  chat about your interests, values, availability, and idea of fun — then calls
  `kinweave_save_persona`. It won't ask for your legal name, address, or contact.
- **"Make a code to connect with my friend."** → `kinweave_make_connect_code`;
  Claude gives you a code to send them.
- **"My friend gave me this code: …"** → `kinweave_use_connect_code`.
- Then Claude walks the steps: *"They'd like to connect — ok?"*, *"Share your
  activity preferences?"*, *"Here's a hangout: coffee at the Meeple Café Sat 11am
  — want in?"* You say yes/no; Claude calls `kinweave_approve` / `kinweave_decline`.
- **"What's the status?"** → `kinweave_status` any time.

Both people do this in their own Claude. When you both approve the hangout, contact
details are exchanged and you're set.

## Tools

| Tool | What it does |
|------|--------------|
| `kinweave_status` | identity, whether a Persona is built, connection state, anything awaiting your OK, the set hangout |
| `kinweave_save_persona` | build/replace your Persona from the conversation (interests + prefs; never identity) |
| `kinweave_make_connect_code` | code to show a friend |
| `kinweave_use_connect_code` | connect using a friend's code |
| `kinweave_approve` / `kinweave_decline` | answer the current owner gate |

## Notes

- **No API key.** The intelligence is your Claude subscription, used as intended.
- **Zone O stays local.** Keys + profile live in `KINWEAVE_HOME`; the relay and any
  counterpart only ever get what the Disclosure Gate permits and you approve.
- **Already built a Persona before installing the connector?** If an AI ran the
  interview and wrote `~/.kinweave/persona-draft.json`, this server adopts it
  automatically on first launch — no need to redo the interview.
- Proven end-to-end in Node (`test/mcp-agent.test.ts`): two agents connect by code
  and reach the same committed hangout over the real relay. The MCP layer itself is
  a thin wrapper; give it a real run in Claude and tell us how the chat flow feels.
