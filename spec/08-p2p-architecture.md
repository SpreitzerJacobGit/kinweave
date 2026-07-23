# 08 — Peer-to-peer architecture

Kinweave is **completely peer-to-peer**. There is no central server, no matchmaking service, no company in the middle, and no trusted third party. Each Persona is a **node** that runs on hardware its owner controls (phone, laptop, home server). The protocol is what two nodes speak to each other; everything else is optional, untrusted, interchangeable infrastructure.

This is a hard requirement, not an aspiration: if a design step needs a trusted central party, it is the wrong design.

## Revised trust zones (no broker)

The earlier drafts had a "Broker" that routed messages and computed compatibility. **That party is deleted.** The zones are now:

- **Zone O — Owner boundary (private).** Raw preferences, values, exact location, contact, Persona memory. Never leaves in raw form.
- **Zone P — Persona runtime (the owner's own node).** Emits only through the Disclosure Gate; treats all inbound as untrusted.
- **Zone T — Transport (untrusted infrastructure).** Dumb message-passing: direct connections, local broadcast, a DHT, or optional relays. It only ever carries **signed, end-to-end-encrypted envelopes**. It sees no plaintext, computes nothing, is interchangeable and self-hostable, and is trusted with **nothing**.
- **Zone X — Counterpart node (untrusted).** A stranger's Persona. Hostile-until-proven.

Added invariant **P6 — No trusted third party.** The only shared state is between the two negotiating peers (the channel transcript, which both hold). All policy — cooldowns, blocks, rate limits, audit — is enforced and stored **locally** by each peer.

## Identity — keys, not accounts

- A Persona's stable identity **is a self-generated public key** (Ed25519). There is no sign-up, no identity provider, no username registry. `envelope.fromPersona` is the pubkey; `envelope.sig` is a real signature over the payload.
- Every message is **signed**; recipients **verify** before treating content even as data. A bad signature is dropped and flagged. (Implemented in `src/core/identity.ts`; verification wired into `src/core/channel.ts` delivery.)
- Sessions are **end-to-end encrypted** between the two Personas' keys, so any relay in Zone T sees only ciphertext + minimal routing metadata.

## Anti-Sybil without a central authority

One-human-per-Persona cannot be enforced by a registry (there isn't one). Instead:

- **Web-of-trust vouching.** Already-trusted peers issue **signed vouches** for a human they've met in person (natural in a local + hobby community). Vouchers stake reputation; bad vouches cost them. Trust is computed **locally** by each node from vouch chains it can verify.
- **Local rootedness signals.** Proximity presence at real hobby venues/events, device attestation, optional decentralized proof-of-personhood — combined, not any single one.
- **Blocks/bans bind to the vouched human identity** and propagate through the web-of-trust, not a central ban list. A blocked human can't return under a fresh key because the fresh key has no vouch path to the victim's circle.

## Discovery — local-first, then gossip/DHT

Because the community is **local + hobby**, discovery is proximity-first:

1. **Local presence beacons (primary).** Signed T0-only announcements over mDNS / Bluetooth LE / local Wi-Fi — "a vouched climber is nearby and open to connect." Models people physically in the same scene. Carries **only public T0 data**, signed.
2. **DHT (Kademlia-style).** For wider reach, nodes announce/lookup under a `community:hobby` key. Stores only signed T0 pointers.
3. **Gossip** among already-connected peers ("friends of friends").
4. **Optional relays (Nostr-style).** Dumb, many, interchangeable, self-hostable — used only for NAT traversal and store-and-forward when a peer is offline. They carry signed, encrypted envelopes and are trusted with nothing. The system is **fully functional with pure local/direct connections**; relays are a convenience, never a dependency.

## Compatibility — computed by the peers, never by a third party

Each peer computes the match **locally** on the coarse `SIGNAL` its counterpart sends (see `src/core/compatibility.ts`), or the two peers run a **two-party private set intersection** directly. No outside party computes or observes anything. The coarse-signal guarantees (non-invertible, non-identifying, oracle-resistant via the probe cap) are unchanged and now matter *more*, because the counterpart peer is the only other party that ever sees them.

## Commitment — a mutual signed receipt, not a global ledger

The S7 two-phase commit produces a **receipt signed by both Personas' keys**, referencing the artifact hash. Each owner keeps their copy. There is no global ledger and no double-spend problem to solve centrally: a hangout is a mutual agreement between two peers, and the idempotent commit (`CommitBook`, keyed on the artifact hash) prevents a peer double-booking itself.

## What this means for the code

The runnable sim already computes match locally and holds all state per-peer, so it is P2P-shaped by construction. The P2P layer being added: `identity.ts` (Ed25519 keys, sign/verify), `transport.ts` (an untrusted relay that only passes signed envelopes and cannot read them), and `discovery.ts` (decentralized local/DHT presence). See the README roadmap.
