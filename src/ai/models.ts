/**
 * Model selection. Kinweave uses Anthropic's latest models. Onboarding synthesis
 * and honest-rationale drafting run on Opus 4.8; a cost tier is offered for
 * high-volume negotiation drafts. See the `claude-api` skill for API details.
 */
export const KINWEAVE_MODEL = 'claude-opus-4-8';
export const KINWEAVE_MODEL_CHEAP = 'claude-sonnet-5';
