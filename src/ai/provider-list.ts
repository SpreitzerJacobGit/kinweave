/**
 * LLM provider registry (browser-safe — no SDK imports, so the PWA can bundle it
 * for the settings screen). The server's factory (providers.ts) turns a
 * ProviderConfig into a live client. Base URLs / models are DEFAULTS and can be
 * overridden per user, so they stay correct even as providers change.
 */

export type ProviderKind = 'anthropic' | 'openai';

export interface ProviderInfo {
  label: string;
  baseURL: string;
  defaultModel: string;
  kind: ProviderKind; // 'openai' = OpenAI-compatible /chat/completions
  keyHint: string;
}

/** A user's or host's choice of provider + credentials. */
export interface ProviderConfig {
  provider: string;
  apiKey: string;
  model?: string;
  baseURL?: string;
}

export const PROVIDERS: Record<string, ProviderInfo> = {
  anthropic: { label: 'Claude (Anthropic API key)', baseURL: 'https://api.anthropic.com', defaultModel: 'claude-opus-4-8', kind: 'anthropic', keyHint: 'sk-ant-...' },
  openai: { label: 'OpenAI', baseURL: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini', kind: 'openai', keyHint: 'sk-...' },
  zai: { label: 'Z.ai (GLM)', baseURL: 'https://api.z.ai/api/paas/v4', defaultModel: 'glm-4.6', kind: 'openai', keyHint: 'your Z.ai API key' },
  moonshot: { label: 'Moonshot / Kimi K2', baseURL: 'https://api.moonshot.ai/v1', defaultModel: 'kimi-k2-0905-preview', kind: 'openai', keyHint: 'sk-...' },
  qwen: { label: 'Qwen (DashScope)', baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', defaultModel: 'qwen-plus', kind: 'openai', keyHint: 'sk-...' },
};
