/**
 * LLM factory — turns a ProviderConfig into a live LLM. Anthropic uses its SDK;
 * OpenAI / Z.ai / Moonshot (Kimi) / Qwen all speak the OpenAI-compatible
 * /chat/completions shape, so one client covers them with different base URLs.
 * (Server-side: imports the Anthropic SDK. Not for the browser bundle.)
 */

import type { LLM, LlmRequest } from './llm';
import { AnthropicLLM } from './llm';
import { PROVIDERS, type ProviderConfig } from './provider-list';

export type { ProviderConfig };

/** Any OpenAI-compatible chat-completions endpoint. */
export class OpenAICompatLLM implements LLM {
  constructor(
    private readonly provider: string,
    private readonly baseURL: string,
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async complete(req: LlmRequest): Promise<string> {
    const messages = [...(req.system ? [{ role: 'system', content: req.system }] : []), ...req.messages];
    const res = await fetch(`${this.baseURL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: req.model ?? this.model, max_tokens: req.maxTokens ?? 1024, messages }),
    });
    if (!res.ok) throw new Error(`${this.provider} ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content ?? '';
  }
}

export function makeLLM(c: ProviderConfig): LLM {
  const info = PROVIDERS[c.provider];
  if (c.provider === 'anthropic' || info?.kind === 'anthropic') {
    return new AnthropicLLM({ apiKey: c.apiKey || undefined, model: c.model ?? info?.defaultModel, baseURL: c.baseURL });
  }
  const baseURL = c.baseURL ?? info?.baseURL;
  const model = c.model ?? info?.defaultModel;
  if (!baseURL || !model) throw new Error(`unknown provider: ${c.provider} (set a base URL + model)`);
  return new OpenAICompatLLM(c.provider, baseURL, c.apiKey, model);
}
