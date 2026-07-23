# 04 — Owner-in-the-loop gates

Implemented via `src/persona/owner.ts` (policy interface) + `Persona.requestConsent` (`src/persona/persona.ts`), invoked by the state machine. Maps to Vervain's `propose_plan` (propose → owner approves → act).

| Gate | Transition | Owner approves | Auto-mode |
|------|-----------|----------------|-----------|
| **G1** | S1 → S2 | *this connection* with this counterpart | not skippable for first contact |
| **G2** | S3 → S4 | begin sharing T2 specifics | skippable if threshold > T2 |
| **G3** | each tier in S4 (+ T4 release in S7) | *the exact fields* revealed (owner may redact) | skippable per-tier below threshold |
| **G4** | S6 → S7 | *the commitment* (the concrete hangout) | **never skippable** without a pre-set constraint envelope |

## Semantics

- On approval of any gate, an append-only `consent-grant` is written to the Consent Ledger; its id becomes the `ownerGateRef` that authorizes subsequent disclosures. This is the audit link the Gate checks for T2+ fields.
- **Autonomous (no gate, but observable):** S0 discovery reads, S2 coarse signals, S5 Persona-level plan convergence, all scoring. None disclose gated PII or create a binding commitment.
- **Async & TTL'd.** In production each gate is a human tap; the Persona ends its turn and resumes when the owner answers, with a per-gate TTL (G1 72h; G2/G3/G4 48h) that routes to an ABANDON `*_timeout` code on expiry. In the sim, an owner is a deterministic **policy function** (`GateDecision`: `approve | deny | redactFields | defer`), where `defer` models a TTL timeout.

## Modes

- `manual` (default) — G1–G4 all active.
- `assisted` — G1 + G4 active; G2/G3 auto up to a `manual_disclosure_tier` (default T2).
- `auto` — only G4 active, and only if the candidate plan satisfies the owner's pre-declared constraint envelope; otherwise falls back to manual G4.

Preset policies for the sim: `approveAll`, `denyAll`, `approveUpToTier`, `denyGate`, `deferGate`.
