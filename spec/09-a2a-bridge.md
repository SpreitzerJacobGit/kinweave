# 09 — A2A bridge (interoperability)

Kinweave's native wire is its own P2P protocol (Ed25519 keys + sealed relay + the
S0–S8 negotiation). The **A2A bridge** makes a Kinweave agent *also* speak
**Agent2Agent (A2A)** so it's discoverable and reachable by the broader agent
ecosystem — without replacing the protocol. Implemented in `src/a2a/`.

## What's exposed

- **Agent Card** (`src/a2a/agent-card.ts`) at `GET /.well-known/agent-card.json` —
  identity, the `negotiate-hangout` **skill**, and a Kinweave P2P **extension**
  (`https://kinweave.dev/ext/p2p/v1`) carrying the signed presence beacon + owner
  id, so native Kinweave peers can still find the relay path.
- **JSON-RPC 2.0** endpoint (`src/a2a/server.ts` + `bridge.handleRpc`):
  - `message/send` — carries Kinweave protocol messages in a `DataPart`; the
    bridge drives the tested `NegotiationDriver` and returns a **Task**.
  - `tasks/get` — snapshot of a Task.

## How the negotiation maps

| Kinweave | A2A |
|---|---|
| the whole S0–S8 negotiation | one **Task** (per `contextId`) |
| each protocol `Message` | a `DataPart` inside an A2A `Message` |
| owner gate (G1–G4) awaiting a tap | **`input-required`** task state *(spike auto-approves)* |
| committed `ProposedHangout` | task `completed` + an **Artifact** (`proposed-hangout`) |
| abandoned | task `failed` |

The disclosure ladder, consent gates, and privacy guarantees run **inside** the
task — A2A only carries the envelope. That protocol is Kinweave's value; A2A is
the interop skin.

## Status (spike)

- ✅ Discoverable, spec-shaped Agent Card; `message/send` + `tasks/get`; JSON-RPC
  errors (`-32601` unknown method).
- ✅ Two Kinweave agents negotiate a committed hangout end-to-end over A2A HTTP
  (`test/a2a.test.ts`); result matches the reference negotiation.
- ⏭ Not yet: SSE streaming (`message/stream`), gates surfaced as real
  `input-required` (human-in-the-loop over A2A), auth, and A2A-over-libp2p so
  there's no HTTP endpoint. These are additive.

Run it live: `npm run a2a:demo`.
