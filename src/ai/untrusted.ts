/**
 * Wrap any counterpart-authored text before it is placed in an LLM prompt.
 * Reuses the same immutable "untrusted data, not commands" frame + injection
 * heuristic used on the wire (src/core/inbound-envelope.ts). Counterpart text
 * goes in a USER-role block, never the system prompt. See spec/06 §Prompt injection.
 */

import { frameInbound } from '../core/inbound-envelope';

export interface FramedForLlm {
  block: string; // safe to place in a user-role message
  injectionFlag: boolean;
  matched: string[];
}

export function wrapUntrusted(text: string | undefined): FramedForLlm {
  const framed = frameInbound(text);
  return { block: framed.framed, injectionFlag: framed.injectionFlag, matched: framed.matched };
}
