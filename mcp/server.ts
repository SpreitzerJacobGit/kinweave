/**
 * Kinweave MCP server — brings Kinweave INTO Claude. Add it to Claude Desktop /
 * Claude Code and your Claude (subscription) becomes the Persona's brain: it
 * builds your profile from chat, makes/uses connection codes, and asks you to
 * approve each disclosure and the final hangout — all with NO API key.
 *
 * Keys + profile (Zone O) are stored locally (KINWEAVE_HOME); the negotiation
 * runs on-device and reaches peers through a relay (KINWEAVE_RELAY). Logs go to
 * stderr only — stdout is the MCP protocol channel.
 *
 * Run: `npx tsx mcp/server.ts`  (env: KINWEAVE_RELAY, KINWEAVE_HOME)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { Node } from '../src/portable/crypto';
import { KinweaveAgent } from '../src/portable/agent';
import { assembleProfile, validateDraft } from '../src/ai/onboarding';
import type { PrivateProfile } from '../src/types/profile';

const HOME = process.env.KINWEAVE_HOME ?? join(homedir(), '.kinweave');
const STATE = join(HOME, 'state.json');
const RELAY = process.env.KINWEAVE_RELAY ?? 'ws://127.0.0.1:8788/relay';

interface Persisted {
  keys?: { idSeed: string; encSeed: string };
  profile?: PrivateProfile;
}

function load(): Persisted {
  try {
    return JSON.parse(readFileSync(STATE, 'utf8')) as Persisted;
  } catch {
    return {};
  }
}
function save(s: Persisted): void {
  mkdirSync(HOME, { recursive: true });
  writeFileSync(STATE, JSON.stringify(s, null, 2));
}

const state = load();
const node = state.keys ? new Node(state.keys) : new Node();
if (!state.keys) {
  state.keys = node.exportSeeds();
  save(state);
}
let profile: PrivateProfile | null = state.profile ?? null;
let agent: KinweaveAgent | null = null;

function ensureAgent(): KinweaveAgent {
  if (!profile) throw new Error('Build your Persona first with kinweave_save_persona.');
  if (!agent) agent = new KinweaveAgent(node, profile, RELAY);
  return agent;
}

const text = (s: string) => ({ content: [{ type: 'text' as const, text: s }] });
const statusText = () => {
  if (!agent) return `identity ${node.id}\nprofile: ${profile ? 'set' : 'not built yet'}\nno active connection`;
  const s = agent.status();
  const lines = [`identity ${s.identity}`, `connection: ${s.connection}`];
  if (s.pendingApproval) lines.push(`NEEDS YOUR OK: ${s.pendingApproval}  (call kinweave_approve or kinweave_decline)`);
  if (s.outcome === 'committed') lines.push(`HANGOUT SET: ${s.hangout}`);
  if (s.outcome === 'abandoned') lines.push(`no match this time`);
  return lines.join('\n');
};

const server = new McpServer({ name: 'kinweave', version: '0.1.0' });

server.tool(
  'kinweave_status',
  'Check your Kinweave state: your identity, whether a Persona is built, the connection status, anything waiting for your approval, and any set hangout.',
  {},
  async () => text(statusText()),
);

server.tool(
  'kinweave_save_persona',
  "Build/replace the user's Kinweave Persona from what they told you. Collect interests and preferences through normal conversation, then call this. Do NOT collect legal name, home address, or precise location.",
  {
    hobbies: z.array(z.string()).describe('interests, e.g. ["climbing","board games","coffee"]'),
    activities: z.array(z.enum(['games', 'food', 'outdoors', 'arts', 'sport', 'learning'])).optional(),
    timeBands: z.array(z.enum(['weekday_day', 'weekday_eve', 'weekend_day', 'weekend_eve'])).optional(),
    energyLevel: z.enum(['low', 'medium', 'high']).optional(),
    settingPref: z.enum(['public_venue', 'outdoor', 'either']).optional(),
    valueTags: z.array(z.string()).optional().describe('vibe, e.g. ["quiet","sober-friendly"]'),
    hardConstraints: z.array(z.string()).optional().describe('e.g. ["no_alcohol"]'),
    groupPref: z.enum(['one_on_one', 'small', 'either']).optional(),
    noveltyPref: z.enum(['familiar', 'new', 'either']).optional(),
    firstName: z.string().describe('shared only after both people approve'),
    contact: z.string().describe('how to reach them day-of, e.g. "signal:@you" — shared only post-commit'),
    geoCell: z.string().optional().describe('rough neighborhood, e.g. "northside"'),
  },
  async (a) => {
    const draft = validateDraft({
      handle: a.firstName,
      community: 'local',
      hobbyTags: a.hobbies,
      geoCell: a.geoCell ?? 'nearby',
      valueTags: a.valueTags ?? [],
      availabilityMask: 15,
      groupPref: a.groupPref ?? 'either',
      activityClasses: a.activities ?? ['games'],
      energyLevel: a.energyLevel ?? 'medium',
      timeBands: a.timeBands ?? ['weekend_day', 'weekend_eve'],
      settingPref: a.settingPref ?? 'public_venue',
      hardConstraints: a.hardConstraints ?? [],
      noveltyPref: a.noveltyPref ?? 'either',
    });
    profile = assembleProfile(draft, {
      ownerId: node.id,
      firstName: a.firstName,
      legalName: '',
      homeCoordinate: { lat: 0, lng: 0 },
      contact: a.contact,
    });
    agent = null; // rebuild with the new profile on next connect
    save({ keys: node.exportSeeds(), profile });
    return text(`Persona saved (interests: ${draft.hobbyTags.join(', ')}). Ready to connect.`);
  },
);

server.tool(
  'kinweave_make_connect_code',
  'Generate a code to show a friend so their Kinweave can connect to yours. Give them the code; then call kinweave_status to see when they connect and what to approve.',
  {},
  async () => {
    const code = await ensureAgent().makeConnectCode();
    return text(`Show your friend this code (they paste it into their Kinweave):\n\n${code}\n\nI'll watch for them — ask me to check the status once they've connected.`);
  },
);

server.tool(
  'kinweave_use_connect_code',
  'Connect using a code a friend gave you. Starts your Personas negotiating; returns the first thing that needs your approval.',
  { code: z.string() },
  async ({ code }) => {
    const a = ensureAgent();
    await a.useConnectCode(code);
    await a.waitForNext();
    return text(statusText());
  },
);

server.tool(
  'kinweave_approve',
  "Approve whatever Kinweave is currently asking the owner to approve. Only call after the user agrees. Returns the next step.",
  {},
  async () => {
    if (!agent?.approve()) return text('Nothing is waiting for approval.\n' + statusText());
    await agent.waitForNext();
    return text(statusText());
  },
);

server.tool(
  'kinweave_decline',
  'Decline the current Kinweave approval (ends this connection politely).',
  {},
  async () => {
    if (!agent?.decline()) return text('Nothing is waiting for approval.');
    await agent.waitForNext();
    return text(statusText());
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write(`kinweave mcp: identity ${node.id}, relay ${RELAY}, home ${HOME}\n`);
