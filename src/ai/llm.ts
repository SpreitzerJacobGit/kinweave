/**
 * LLM abstraction. The Persona logic depends on this interface, not on a
 * concrete SDK, so (a) tests inject a deterministic StubLLM and (b) the real
 * Anthropic client (which needs a key + network) stays out of the test path.
 *
 * The LLM is a PROPOSAL engine only: whatever it returns is re-filtered by the
 * Disclosure Gate and still requires an owner tap. It never decides disclosure
 * tier or consent. See spec/06 and src/ai/scrub.ts.
 */

import { KINWEAVE_MODEL } from './models';

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LlmRequest {
  system?: string;
  messages: LlmMessage[];
  maxTokens?: number;
  model?: string;
}

export interface LLM {
  complete(req: LlmRequest): Promise<string>;
}

/** Real Anthropic-backed LLM. The SDK is imported lazily so tests never load it. */
export class AnthropicLLM implements LLM {
  constructor(private readonly opts: { apiKey?: string; baseURL?: string; model?: string } = {}) {}

  async complete(req: LlmRequest): Promise<string> {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: this.opts.apiKey, baseURL: this.opts.baseURL });
    const res = await client.messages.create({
      model: req.model ?? this.opts.model ?? KINWEAVE_MODEL,
      max_tokens: req.maxTokens ?? 2048,
      // Adaptive thinking (`thinking: { type: 'adaptive' }`) is recommended on
      // opus-4-8; enable it once the installed SDK version types that variant.
      system: req.system,
      messages: req.messages,
    });
    return res.content
      .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
      .map((b) => b.text)
      .join('');
  }
}

/** Deterministic stub for tests — returns whatever the supplied function produces. */
export class StubLLM implements LLM {
  constructor(private readonly reply: (req: LlmRequest) => string) {}
  async complete(req: LlmRequest): Promise<string> {
    return this.reply(req);
  }
}
