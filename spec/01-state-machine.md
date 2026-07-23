# 01 — State machine (S0–S8)

Implemented in `src/core/state-machine.ts`. A "round" is one A→B→A exchange within a stage.

```
S0 DISCOVERY → S1 HANDSHAKE → S2 MATCH_PROBE → S3 INTENT_ALIGN
   → S4 DISCLOSE_LADDER ⇄ S5 COPLAN → S6 OWNER_REVIEW → S7 COMMIT → S8 CLOSED
```

| Stage | What happens | Owner gate | Cap | Failure → |
|-------|--------------|-----------|-----|-----------|
| **S0 Discovery** | Peers find each other via decentralized local presence beacons / DHT (no central matchmaker); coarse T0/T1 signals only. Autonomous. | — | — | `low_match` (different community) |
| **S1 Handshake** | Exchange `HELLO`/`HELLO_ACK`; open channel. | **G1** connection | 1 | `declined` / `timeout` |
| **S2 Match-probe** | Exchange coarse `SIGNAL` (quantized); each computes a local match band. | — | probe 2 | `low_match` |
| **S3 Intent-align** | Abstract `INTENT_FRAME`; agree the archetype (activity class, energy, time band). | **G2** disclosure consent | align 3 | `archetype_mismatch` |
| **S4 Disclose-ladder** | Climb T2 then T3 in **lockstep reciprocity**; interleaves with S5. | **G3** per-tier fields | — | `disclosure_refused` / `owner_timeout` |
| **S5 Co-plan** | Symmetric `PLAN_PROPOSAL` → `PLAN_REVIEW(accept\|counter)`; a counter re-wakes the proposer. | — | coplan 4 | `no_feasible_plan` |
| **S6 Owner-review** | The `ProposedHangout` is surfaced to **both** owners. | **G4** commitment (hard) | owner 2 | `owner_declined` / `owner_timeout` |
| **S7 Commit** | T4 coordination released, then idempotent two-phase commit on the artifact hash. | G3@T4 for release | — | `commit_failed` |
| **S8 Closed** | Binding hangout; feedback hook recalibrates future thresholds. | — | — | — |

## Terminal ABANDON codes

`declined, timeout, low_match, archetype_mismatch, disclosure_refused, no_feasible_plan, owner_declined, owner_timeout, commit_failed, budget_exhausted`.

All are **graceful**: the counterpart receives only a generic face-saving `publicReason`; the true reason stays owner-side (in the result's `trueReason` and the Consent Ledger). Reachability of every code is asserted in `test/protocol.test.ts`.

## Notes on the sim

- The orchestrator never reads a Persona's private profile; it only moves messages over the `Channel` and invokes owner gates. The output artifact is assembled strictly from what was **disclosed on the channel**.
- S4↔S5 interleave in the spec; the sim discloses T2 then T3 in lockstep before co-planning, reusing the T3 grant for plan proposals. Full interleave and the S6→S5 owner-edit loop are specified but simplified in this first cut (flagged in code).
