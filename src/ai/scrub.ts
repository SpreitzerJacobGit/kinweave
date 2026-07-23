/**
 * Pre-send scrubber — defense in depth atop the Disclosure Gate. Throws BEFORE
 * an outbound LLM prompt leaves the device if it contains a Zone-O secret value
 * or a never-disclose field key. The Gate protects the wire; this protects the
 * AI-proxy hop (which the relay's E2E encryption does not cover). See spec/06.
 */

import { NEVER_DISCLOSE } from '../types/disclosure';

export class PromptLeakError extends Error {
  constructor(public readonly leaked: string) {
    super(`refusing to send prompt: contains protected value/key "${leaked}"`);
    this.name = 'PromptLeakError';
  }
}

/**
 * @param prompt the full text about to be sent to the LLM/proxy
 * @param secretValues raw Zone-O values that must never appear (home coords, legal name, contact…)
 */
export function assertPromptClean(prompt: string, secretValues: readonly string[]): void {
  for (const key of NEVER_DISCLOSE) {
    // A bare mention of the field NAME is fine; a JSON-ish "key": is a leak signal.
    if (new RegExp(`"${key}"\\s*:`).test(prompt)) throw new PromptLeakError(key);
  }
  for (const value of secretValues) {
    if (value && value.length >= 3 && prompt.includes(value)) throw new PromptLeakError(value);
  }
}
