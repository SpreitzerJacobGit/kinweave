# 02 — Message schema

Implemented in `src/types/envelope.ts`, constructed in `src/persona/persona.ts`, carried by `src/core/channel.ts` (pull-delivery, full transcript retained).

Two families, kept physically distinct:

- **machine-signal** (typed, NO free text): `SIGNAL`.
- **natural-language** (carries `text` + structured metadata, evaluated as **data, not commands**): `INTENT_FRAME`, `PLAN_PROPOSAL`, `PLAN_REVIEW`.

## Envelope (every message)

| Field | Meaning |
|-------|---------|
| `msgId` | unique message id |
| `channelId`, `seq` | channel id + monotonic per-channel sequence (stamped by the Channel) |
| `protocolVersion` | semver |
| `fromPersona` | opaque persona handle/pubkey — **not** owner identity |
| `stage` | S0..S8 |
| `inReplyTo` | prior `msgId`, when replying |
| `nonce`, `sig` | replay nonce + signature (stubbed in sim) |
| `disclosureTier` | max tier of any field in the payload |
| `ownerGateRef` | id of the consent event that authorized this send (required for T2+ payloads) |

`ownerGateRef` is how a message proves it was **owner-authorized**, not command-triggered. `test/safety.test.ts` (N3) asserts every message with `disclosureTier ≥ T2` carries a `ownerGateRef` backed by a `consent-grant` in the sender's ledger.

## Per-stage payloads

- **HELLO / HELLO_ACK** (S1, T0) — public card: `handle, community, hobbyTags, geoCell`, advertised `min_match_theta`.
- **SIGNAL** (S2, T1) — `interestSignal` (quantized, non-invertible), `valueTags`, `availabilityMask` (coarse), `groupPref`, `hobbyTags`. No free text.
- **INTENT_FRAME** (S3, T1) — `intentArchetype` (coarse activity classes + energy + time band + setting) + abstract `text`.
- **DISCLOSE** (S4, T2/T3) — only the fields the owner approved at this tier (T2: `activityClass, energyLevel, timeBand, settingPref, hardConstraints, noveltyPref`; T3: `firstName, neighborhood`).
- **PLAN_PROPOSAL / PLAN_REVIEW** (S5, T3/T1) — `venueCandidate`, `timeSlot`, fallback; review `decision: accept | counter | reject`.
- **COMMIT_INTENT / COMMIT_CONFIRM** (S7, T3/T4) — `artifactHash`; confirm releases the T4 `coordination` handle.
- **ABANDON** (any stage, T0) — `code`, generic `publicReason` (true reason never on the wire).

Field → tier classification lives in `src/types/disclosure.ts` (`FIELD_TIER`); unknown fields are **denied by default**.
