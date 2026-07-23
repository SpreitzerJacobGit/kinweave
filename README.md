# Kinweave

A **completely peer-to-peer** social network made of **personal AI Personas** that know their owner and negotiate, on their owner's behalf, with other people's Personas to arrange local, real-world hangouts — inside a **local + hobby community**, with the **human owner in the loop** at every consequential step. No central server, no matchmaking company in the middle: each Persona is a node you control (see [`spec/08-p2p-architecture.md`](spec/08-p2p-architecture.md)).

This repository is the **first deliverable: the negotiation protocol** — the hardest and most valuable piece, because it is where two agents representing two *different, stranger* owners exchange intimate preferences across a trust boundary. It ships as:

1. a **written spec** (`spec/`), the source of truth, and
2. a **runnable TypeScript simulation** (`src/`, `test/`) that drives two mock Personas — plus an adversarial red-team Persona — end-to-end, with the safety boundaries **structurally enforced** and asserted by tests.

No UI, no real matching/ML, no persistence — those are deliberately out of scope here (see the plan).

## Quick start

```bash
npm install
npm run sim -- --pair compatible      # drives S0..S8 to a committed hangout
npm run sim -- --pair incompatible    # graceful abandon (low_match)
npm run sim -- --adversary scraper    # jailbroken Persona: raw fields refused by the Gate
npm run sim -- --adversary injector   # prompt-injection inbound: flagged, no state change
npm run sim -- --adversary oracle     # compatibility probe cap enforced
npm test                              # 27 tests: protocol + north-star safety
npm run typecheck
```

## How it works (one screen)

Kinweave is **completely peer-to-peer** — no central server, no broker, no trusted third party (`spec/08`). Four trust zones: **O** owner boundary (private, raw preferences never leave), **P** the owner's own Persona node, **T** untrusted transport (dumb relays / DHT / local broadcast that only ever carry signed, end-to-end-encrypted envelopes), **X** the untrusted counterpart node. Two control planes everything hangs off:

- **Disclosure Gate** (`src/core/disclosure-gate.ts`) — the single outbound chokepoint. Every field passing to the wire is classified to a tier and checked against the current consented tier and the hard-boundary set, **on output**, independent of what the Persona model "decided". A jailbroken Persona cannot exceed its tier.
- **Consent Ledger** (`src/core/consent-ledger.ts`) — append-only record of every consent grant and disclosure. The proof that the owner was in the loop. Cannot be disabled.

The negotiation is a 9-stage machine (`src/core/state-machine.ts`): `S0 Discovery → S1 Handshake → S2 Match-probe → S3 Intent-align → S4 Disclose-ladder ⇄ S5 Co-plan → S6 Owner-review → S7 Commit → S8 Closed`. Owner gates **G1–G4** sit on connection, disclosure-consent, per-field reveal, and the hard commitment. A monotonic **T0–T4** disclosure ladder reveals coarse→specific in lockstep reciprocity; **T4** (exact meeting point, contact) is released only *post-commit*.

## North-star guarantee

> Even a fully jailbroken own-Persona **plus** a maximally hostile counterpart must not (a) extract raw preferences, (b) learn exact location or legal name, (c) advance disclosure or exchange contact without an owner consent event, or (d) disable logging.

These are the assertions in `test/safety.test.ts`. If any fails, the fix belongs in the **boundary** (Gate/Ledger), never the prompt.

## Layout

```
spec/   the written protocol spec (source of truth)
src/
  types/    code contracts that mirror the spec
  core/     the safety spine — gate, ledger, inbound framing, compatibility, channel, state machine
  persona/  the Persona actor (holds Zone O privately) + owner gate interface
  sim/      fixtures, adversary, CLI runner
test/   protocol coverage + north-star safety assertions
```

## Roadmap

This is v0.1 — the protocol as spec + runnable simulation. Next, toward a fully peer-to-peer reference node:

- `src/core/identity.ts` — Ed25519 keypairs; sign/verify every message (identity = a public key, no accounts).
- `src/core/transport.ts` — an untrusted relay abstraction that only passes signed, encrypted envelopes and cannot read them.
- `src/core/discovery.ts` — decentralized local presence beacons + DHT-style announce (no central matchmaker).
- Then: web-of-trust vouching (anti-Sybil without a registry), and a real network transport (libp2p / WebRTC / Nostr relays).

Contributions welcome — the protocol spec in `spec/` is the source of truth; implementations in any language should conform to it.

## License

MIT — see [`LICENSE`](LICENSE). (An open protocol meant to be implemented freely by anyone. If a patent grant is preferred for wider standardization, Apache-2.0 is a one-file swap.)

---

Codename note: this project was briefly scaffolded as "Kith"; it is now **Kinweave**.
