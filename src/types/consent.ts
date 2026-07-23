/**
 * Consent + audit record types. The Consent Ledger (src/core/consent-ledger.ts)
 * is the append-only source of truth for "was the owner actually in the loop".
 * See spec/06-threat-model-and-safety.md §Auditability.
 */

import type { Tier } from './disclosure';

export type GateId = 'G1' | 'G2' | 'G3' | 'G4';

export type EventType =
  | 'consent-grant' // owner approved a gate (connection / tier / fields / commitment)
  | 'consent-revoke'
  | 'disclosure-out' // a field left the owner boundary
  | 'inbound-received' // a counterpart message was ingested (as data)
  | 'level-change' // the mutual disclosure tier advanced
  | 'refusal' // the Gate refused to emit a field (hard boundary / above tier / no consent)
  | 'injection-flag' // an inbound message tripped the injection heuristic
  | 'block'
  | 'report';

export interface LedgerEvent {
  id: string;
  seq: number;
  ts: number; // logical tick (deterministic within a run)
  type: EventType;
  gate?: GateId;
  counterpart: string; // pseudonymous counterpart handle
  tierFrom?: Tier;
  tierTo?: Tier;
  fields?: string[]; // attribute KEYS disclosed/refused — never raw values
  authorizingConsent?: string; // id of the consent-grant that authorized a disclosure
  provenance?: 'verified' | 'inferred'; // over-sell guard: was the claim grounded in the verified profile?
  confidence?: number; // 0..1
  injectionFlag?: boolean;
  reason?: string;
  note?: string;
}
