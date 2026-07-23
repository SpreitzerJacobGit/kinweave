# 10 — Social graph: community QR, discovery, and composable trust

Status: design of record for the community/network layer. This spec extends the
pairwise negotiation (spec/00–07) and the P2P architecture (spec/08). It does
**not** modify the negotiation kernel: the 2-party gated negotiation + Disclosure
Gate + Consent Ledger is frozen. Everything here **composes** on top of it.

## 0. Principle — atoms frozen, graph composed

The pairwise gated negotiation is the security atom; the social graph is emergent
and composed from atoms plus **signed metadata**. New social features (join a
community, introductions, groups, verification methods) are added as new signed
**attestation/edge types**, never as new engines. Consequences:

- **The graph is sovereign and local-first.** Each node holds only its own
  neighborhood. No global graph is materialized anywhere; traversal past your
  neighbors requires consented, hop-by-hop relaying.
- **Joining a community ≠ connecting to anyone.** Presence in a community is T0;
  every real person-to-person connection still runs the full G1–G4 negotiation.

## 1. The `kw1` invite envelope

One self-describing envelope backs every front door (PWA, agent/MCP, QR),
carrying its own `relays[]` so there is no out-of-band relay coupling.

- `kind: 'invite'` — single-use pairwise: a signed presence beacon + rendezvous
  nonce (`rt`) + expiry. The "connect with me" code.
- `kind: 'community'` — the reusable community descriptor (below). The "join this
  network" poster QR.

Encoded as portable base64url at `#kw1=<payload>` (fragment → never sent to the
relay). Legacy `#pair=` invite links remain parseable.

## 2. Community identity

A community **is** an Ed25519 keypair. Its id is `fingerprint(communityPubKey)`,
so it is **self-certifying** — no server allocates, owns, or registers
communities; names are display strings, collisions resolved by which QR you
scanned. The community key **only signs the public descriptor**; it never
decrypts, and members never hold it (no shared-secret honeypot).

The `CommunityDescriptor` carries transport (`relays`) **and** trust (`policy`,
`trustRoots`, `issuerAllowList`) so one scan gives a joiner both where to
rendezvous and the Sybil bar to clear. `verifyCommunity` binds id↔key↔contents,
so a hostile relay cannot weaken a community's policy or forge its identity.

## 3. Public community board (transport, spec/08 Zone T)

Discovery over the wire is a relay capability keyed by **community id** (distinct
from the point-to-point mailbox keyed by recipient fingerprint). It stores **only
public, signed T0 presence beacons**, deduped by pubkey, with TTL + size + rate
caps; reads are public and **re-verified client-side**. The board can never read
prefs, matchmake, rank, or hold a private key — it returns the raw verified
beacon set; all selection is client-side.

## 4. Composable trust (Sybil resistance)

Verification is a signed **Attestation** (a credential atom). A community's bar is
a data-described **TrustPolicy** combining attestation types
(`co-presence OR (unique-human AND 2 vouches)`, …). v1 attestation types:
**co-presence** (mutual, in-person), **vouch**/**vouch-revoke** (web-of-trust),
**unique-human** (blinded proof-of-personhood; the token proves a verified unique
human via an unlinkable tag — the phone number never touches the network).

Privacy invariant: an attestation never carries PII. `subject`/`issuer` are keys
or fingerprints; `claims` are coarse. The joiner's attestation bundle travels
inside the **sealed HELLO**; the receiving member verifies it, scores it, and
checks the policy **before G1** (the existing `checkComm­unity` seam) — so gating
connectability never touches owner consent.

## 5. Trust model

**Trust = capacity-bounded flow from a seed set (guardians), decaying each hop.**
Not raw degree (the #1 Sybil hole). Two rules:

- *More links → more trusted* becomes **trust-weighted in-degree with a
  per-voucher budget**: a member spreads a fraction (`decay d<1`) of their own
  trust *split* across everyone they vouch for. Mass-vouching dilutes to ~0.
- *Trusted peers make you trusted* is **eigenvector recursion**, but Sybil
  resistance comes from the **seed**, not the math: a cluster with no path from a
  `trustRoot` scores ~0 however interlinked.

**Relative authority (no guardian class).** A member's power over another = the
fraction of that other's trust that flows through them. Blocking reduces trust in
proportion to how much routed through the blocker; the founder's reach is wide
only because they are the seed. Rogue-node damage is structurally local and
upstream-prunable; removing a predator community-wide = a seed-adjacent member
blocks them.

**Rooting: hybrid.** Each device scores as flow from the **shared community seed**
(`trustRoots`) PLUS the owner's **personal** trusted/distrusted roots. Personal
distrust vetoes locally; personal trust adds only a bounded local boost (never
overrides a community-seed block).

**Easy start.** Presence is decoupled from trust. Trust-0 (just scanned) can
browse and send connect-requests into a rate-limited **stranger tray**. Cheap
on-ramps to the trust floor: one in-person co-presence, one vouch, or a
verified-human token.

**Negative axis (scammers and bad actors).** Signed block/report attestations
propagate (trusted flags → negative trust → filtered from discovery). **Voucher
clawback:** if your vouchee is blocked by trusted members, a slice of the penalty
flows back to you — so a vouch costs something.

**Honest bound.** Scammers reaching "trusted" is bounded by how many trusted
members are fooled into vouching near the seed × decay; damage stays local and
revocable.

The scorer lives behind a `TrustScorer` interface so a fuller EigenTrust /
Advogato max-flow metric can replace the v1 bounded-depth seeded flow without
changing callers.

## 6. Anti-central-authority guardrails (must hold)

- Community id = `fingerprint(pubKey)`; no name registry, no server-allocated ids.
- Board returns raw verified beacons only — no ranking, no "suggested people".
- The community key only signs the public descriptor; all secrecy stays in
  per-pair sealed boxes.
- Any proof-of-personhood issuer is pluggable/self-hostable, cannot link tokens to
  people, and cannot read negotiations (Zone T).

## 7. Implementation status

- **This PR (Milestones 0–1):** `kw1` invite atom (`src/portable/invite.ts`),
  community identity/descriptor (`src/portable/community.ts`), attestation model
  (`src/portable/attestation.ts`, `src/types/attestation.ts`), and the trust-policy
  evaluator with the `unique-human` slot (`src/portable/trust-policy.ts`). No
  behavior change to existing flows.
- **Next:** the public community board + networked discovery (Milestone 2), then
  co-presence + vouch + the enforcement seam (Milestone 3), surfaces (4), and the
  blinded PoP issuer (5).
