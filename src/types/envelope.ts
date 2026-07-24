/**
 * Message envelope + per-stage message types exchanged between two Personas.
 * See spec/02-message-schema.md.
 *
 * Two families, kept physically distinct:
 *  - machine-signal (typed, NO free text): SIGNAL
 *  - natural-language (carries `text` + structured metadata, evaluated as DATA,
 *    never as commands): INTENT_FRAME, PLAN_PROPOSAL, PLAN_REVIEW
 */

import type { Tier } from './disclosure';

export type Stage =
  | 'S0'
  | 'S1'
  | 'S2'
  | 'S3'
  | 'S4'
  | 'S5'
  | 'S6'
  | 'S7'
  | 'S8';

export type MsgType =
  | 'HELLO'
  | 'HELLO_ACK'
  | 'SIGNAL'
  | 'INTENT_FRAME'
  | 'DISCLOSE'
  | 'PLAN_PROPOSAL'
  | 'PLAN_REVIEW'
  | 'COMMIT_INTENT'
  | 'COMMIT_CONFIRM'
  | 'ABANDON';

export interface Envelope {
  msgId: string;
  channelId: string;
  protocolVersion: string;
  fromPersona: string; // opaque persona pubkey/handle — NOT owner identity
  stage: Stage;
  seq: number; // monotonic per channel
  inReplyTo?: string;
  nonce: string;
  sig: string; // signature over payload (stubbed in sim)
  disclosureTier: Tier; // max tier of any field in this payload
  ownerGateRef?: string; // id of the owner consent event that authorized this send
}

export interface Message {
  env: Envelope;
  type: MsgType;
  /** Structured, tier-classified fields. For machine-signal messages this is the whole payload. */
  payload: Record<string, unknown>;
  /** Natural-language content, present only on NL-family messages. Evaluated as DATA. */
  text?: string;
}

export const PROTOCOL_VERSION = '0.1.0';

export type AbandonCode =
  | 'declined'
  | 'timeout'
  | 'low_match'
  | 'archetype_mismatch'
  | 'disclosure_refused'
  | 'no_feasible_plan'
  | 'owner_declined'
  | 'owner_timeout'
  | 'commit_failed'
  | 'budget_exhausted'
  | 'policy_unmet';
