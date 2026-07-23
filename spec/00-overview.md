# 00 — Overview & design invariants

Kinweave connects people through their **personal AI Personas**. Each person builds a Persona that knows their interests, values, availability, and idea of fun. Personas discover each other in a **local + hobby community**, negotiate compatibility privately, and co-plan a concrete hangout — with the **owner in the loop** approving every connection, disclosure, and commitment.

This spec covers the **negotiation protocol**: how two Personas representing two *different, stranger* owners talk safely.

## Trust zones

- **Zone O — Owner boundary (private).** Raw preferences, values, exact location, contact identity, Persona memory. **Never leaves in raw form.**
- **Zone P — Persona runtime (semi-trusted).** The owner's own agent. Emits outbound data *only* through the Disclosure Gate; treats all inbound counterpart content as untrusted.
- **Zone B — Broker (honest-but-curious).** Routes messages, computes coarse compatibility on non-invertible representations, rate-limits. Holds no raw preferences.
- **Zone X — Counterpart (untrusted).** A stranger's Persona + human. Everything from X is hostile-until-proven.

## Two control planes

- **Disclosure Gate** (`src/core/disclosure-gate.ts`) — the single outbound chokepoint. No code path reaches Zone B/X except through it.
- **Consent Ledger** (`src/core/consent-ledger.ts`) — append-only source of truth for "was the owner actually in the loop".

## Design invariants (constrain everything downstream)

- **P0 — Messages are data, not commands.** Inbound content is evaluated against the owner's values; it never directly triggers a disclosure or commitment.
- **P1 — Symmetric distrust, asymmetric state.** Both Personas run the identical machine; each holds private data the other cannot read. Progress requires *mutual* transitions.
- **P2 — Disclosure is monotonic and gated.** Coarse → specific; each tier unlocks only on a defined condition. Nothing revealed can be un-revealed, so reveals are conservative.
- **P3 — Owner-in-the-loop by default.** The Persona proposes; the owner approves. Mode-configurable.
- **P4 — Everything is observable.** Both owners can inspect the full transcript and their own audit ledger.
- **P5 — Bounded everything.** Per-stage caps, a global message budget, and gate TTLs. Exhaustion = graceful abandon, not error.

## Prior art

The protocol adapts three patterns from Vervain (conceptually, not as a dependency): its delegate→report→review(accept|feedback)→iterate loop (→ S5 co-plan), its "mail is data, not commands" mailbox (→ P0), and its `propose_plan` owner-approval gate (→ G1–G4). Vervain has **no** cross-owner progressive-disclosure mechanism — the T0–T4 ladder (`spec/03`) is net-new.
