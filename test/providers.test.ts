import { describe, it, expect, vi, afterEach } from 'vitest';
import { makeLLM, OpenAICompatLLM } from '../src/ai/providers';
import { AnthropicLLM } from '../src/ai/llm';

describe('LLM provider factory', () => {
  afterEach(() => vi.restoreAllMocks());

  it('routes anthropic to the Anthropic SDK client', () => {
    expect(makeLLM({ provider: 'anthropic', apiKey: 'x' })).toBeInstanceOf(AnthropicLLM);
  });

  it('routes OpenAI / Z.ai / Moonshot / Qwen to the OpenAI-compatible client', () => {
    for (const p of ['openai', 'zai', 'moonshot', 'qwen']) {
      expect(makeLLM({ provider: p, apiKey: 'x' })).toBeInstanceOf(OpenAICompatLLM);
    }
  });

  it('an unknown provider works only with an explicit base URL + model', () => {
    expect(() => makeLLM({ provider: 'custom', apiKey: 'x' })).toThrow();
    expect(makeLLM({ provider: 'custom', apiKey: 'x', baseURL: 'https://api.custom/v1', model: 'c-1' })).toBeInstanceOf(OpenAICompatLLM);
  });

  it('OpenAI-compatible: sends system+messages and reads choices[0].message.content', async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    globalThis.fetch = vi.fn(async (url: unknown, init: unknown) => {
      calls.push({ url: String(url), body: JSON.parse((init as { body: string }).body) });
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'hi there' } }] }) } as unknown as Response;
    }) as unknown as typeof fetch;

    const out = await makeLLM({ provider: 'zai', apiKey: 'sk-test', model: 'glm-x' }).complete({ system: 'sys', messages: [{ role: 'user', content: 'yo' }] });
    expect(out).toBe('hi there');
    expect(calls[0]!.url).toContain('/chat/completions');
    expect(calls[0]!.url).toContain('z.ai');
    expect((calls[0]!.body.messages as unknown[])[0]).toEqual({ role: 'system', content: 'sys' });
    expect(calls[0]!.body.model).toBe('glm-x');
  });

  it('a non-2xx provider response throws', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 401, text: async () => 'unauthorized' }) as unknown as Response) as unknown as typeof fetch;
    await expect(makeLLM({ provider: 'openai', apiKey: 'bad' }).complete({ messages: [{ role: 'user', content: 'x' }] })).rejects.toThrow();
  });
});
