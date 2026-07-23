# 03 — Progressive disclosure ladder (core IP)

Implemented in `src/types/disclosure.ts` (classification) + enforced by `src/core/disclosure-gate.ts`. This is the net-new part with no prior art.

Monotonic tiers. Each reveal is **reciprocal (lockstep)** and the unlock condition **escalates in kind**.

| Tier | Data class | Unlock condition |
|------|-----------|------------------|
| **T0 Public** | community, hobby tag, coarse geo cell, handle | default |
| **T1 Compatibility** | `interestSignal` (quantized), value tags, coarse availability mask, group pref, `intentArchetype` | **mutual interest** — both open channel + G1 |
| **T2 Intent specifics** | activity class, energy, time band, setting, hard constraints, novelty pref | **mutual match ≥ θ** + **G2** consent |
| **T3 Plan specifics** | venue candidate, real time slot, neighborhood, first name, photo | **reciprocal T2 done** + **G3** field approval |
| **T4 Coordination** | exact meeting point, contact channel, precise time | **mutual binding commitment (G4)** — released **post-commit only** |

## Hard invariants (enforced structurally by the Gate)

- **Raw preferences never leave Zone O.** Only a **quantized, non-invertible** derivative (`interestSignal`) may leave — never the raw `interestVector`.
- **Never-disclose set** (`NEVER_DISCLOSE`): `homeCoordinate, exactLocation, realtimeLocation, legalName, govId, dateOfBirth, financial, interestVector, personaMemory`, and all special-category data (`health, sexuality, religion, ethnicity, politics, disability`). Refused at **any** tier, with any consent grant. (`test/safety.test.ts` N2.)
- **Tier ceiling on output.** A field whose tier exceeds the current consented tier is refused — regardless of what the Persona model decided. This is what makes a jailbroken Persona harmless (N1).
- **T2+ requires a consent grant.** A T2-or-higher field with no valid `ownerGateRef` grant is refused `no-consent` (N3).
- **Deny by default.** An unrecognized field key is refused `unknown-field`.

## Reciprocity

Disclosure climbs tier-by-tier in lockstep: a Persona discloses tier N only after the counterpart has disclosed (or committed to disclose) tier N−1. This is **defection-resistant** — the worst a bad actor can extract is one tier ahead of an owner gate. See `src/core/state-machine.ts` S4 loop.

## Over-sell guard

Every disclosed field is tagged `provenance: verified | inferred` in the ledger, based on whether the value is grounded in the Persona's verified field set. A Persona may not present an ungrounded inference as verified fact. (`test/safety.test.ts` N6.)
