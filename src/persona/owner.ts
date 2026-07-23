/**
 * Owner approval interface — the human-in-the-loop.
 *
 * In production each gate is an async, TTL'd human tap. In the simulation an
 * owner is a deterministic POLICY function so runs are reproducible; the shape
 * mirrors the real gate (approve / deny / redact fields / defer=timeout).
 * See spec/04-owner-gates.md.
 */

import type { GateId } from '../types/consent';
import type { Tier } from '../types/disclosure';
import type { ProposedHangout } from '../types/artifact';

export interface GateRequest {
  gate: GateId;
  counterpart: string;
  tierTo?: Tier; // for G2/G3
  fields?: string[]; // for G3 — the exact fields about to be revealed
  artifact?: ProposedHangout; // for G4
}

export interface GateDecision {
  approve: boolean;
  /** For G3: a subset of `fields` the owner refuses to reveal. */
  redactFields?: string[];
  /** Simulate no response within TTL -> the gate times out and abandons. */
  defer?: boolean;
  reason?: string;
}

export type OwnerPolicy = (req: GateRequest) => GateDecision;

/** Approve every gate (used for the happy-path compatible pair). */
export const approveAll: OwnerPolicy = () => ({ approve: true });

/** Deny every gate. */
export const denyAll: OwnerPolicy = () => ({ approve: false, reason: 'policy:deny-all' });

/** Approve up to (and including) a tier ceiling; deny disclosure gates above it. */
export function approveUpToTier(ceiling: Tier): OwnerPolicy {
  return (req) => {
    if ((req.gate === 'G2' || req.gate === 'G3') && req.tierTo !== undefined) {
      return req.tierTo <= ceiling
        ? { approve: true }
        : { approve: false, reason: `policy:tier>${ceiling}` };
    }
    return { approve: true };
  };
}

/** Deny a specific gate, approve the rest. */
export function denyGate(gate: GateId): OwnerPolicy {
  return (req) =>
    req.gate === gate
      ? { approve: false, reason: `policy:deny-${gate}` }
      : { approve: true };
}

/** Never answer a specific gate (times out -> abandon). */
export function deferGate(gate: GateId): OwnerPolicy {
  return (req) => (req.gate === gate ? { approve: false, defer: true } : { approve: true });
}
