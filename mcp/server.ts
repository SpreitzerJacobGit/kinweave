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
import { mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Node } from '../src/portable/crypto';
import { KinweaveAgent } from '../src/portable/agent';
import { assembleProfile, validateDraft } from '../src/ai/onboarding';
import { ACTIVITY_CLASSES, TIME_BANDS, ENERGY_LEVELS, SETTING_PREFS, GROUP_PREFS, NOVELTY_PREFS } from '../src/types/vocab';
import type { PrivateProfile } from '../src/types/profile';
import { emptyStore, upsertConnection, addTag, createGroup, setInGroup, connectionsList, groupsFor, type SocialStore, type Connection } from '../src/portable/social';

const HOME = process.env.KINWEAVE_HOME ?? join(homedir(), '.kinweave');
const STATE = join(HOME, 'state.json');
const DRAFT = join(HOME, 'persona-draft.json'); // handoff: an AI that read the repo (no MCP yet) drops a ProfileDraft here
const RELAY = process.env.KINWEAVE_RELAY ?? 'ws://127.0.0.1:8788/relay';

interface Persisted {
  keys?: { idSeed: string; encSeed: string };
  profile?: PrivateProfile;
  social?: SocialStore;
}

function load(): Persisted {
  try {
    return JSON.parse(readFileSync(STATE, 'utf8')) as Persisted;
  } catch {
    return {};
  }
}
function save(): void {
  mkdirSync(HOME, { recursive: true });
  writeFileSync(STATE, JSON.stringify({ keys: node.exportSeeds(), profile: profile ?? undefined, social }, null, 2));
}

const state = load();
const node = state.keys ? new Node(state.keys) : new Node();
let profile: PrivateProfile | null = state.profile ?? null;
const social: SocialStore = state.social ?? emptyStore();
let agent: KinweaveAgent | null = null;

/**
 * No-MCP handoff pickup: if the owner had their AI run the interview before this
 * connector existed, it wrote a portable ProfileDraft to ~/.kinweave/persona-draft.json.
 * Adopt it on first launch when no Persona is set, then retire the file.
 */
function adoptDraftFile(): void {
  if (profile) return;
  let raw: string;
  try {
    raw = readFileSync(DRAFT, 'utf8');
  } catch {
    return;
  }
  try {
    const draft = validateDraft(JSON.parse(raw));
    profile = assembleProfile(draft, { ownerId: node.id, firstName: '', legalName: '', homeCoordinate: { lat: 0, lng: 0 }, contact: '' });
    unlinkSync(DRAFT);
    process.stderr.write(`kinweave: adopted persona draft from ${DRAFT}\n`);
  } catch (e) {
    process.stderr.write(`kinweave: ignoring invalid ${DRAFT}: ${(e as Error).message}\n`);
  }
}
adoptDraftFile();
save();

function ensureAgent(): KinweaveAgent {
  if (!profile) throw new Error('Build your Persona first with kinweave_save_persona.');
  if (!agent) {
    agent = new KinweaveAgent(node, profile, RELAY, (info) => {
      upsertConnection(social, { id: info.id, name: info.name, when: Date.now(), hangout: info.hangout });
      save();
    });
  }
  return agent;
}

function findConn(nameOrId: string): Connection | undefined {
  const q = nameOrId.trim().toLowerCase();
  return Object.values(social.connections).find((c) => c.id === nameOrId || c.name.toLowerCase() === q);
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
  "Build/replace the user's Kinweave Persona from what they told you. Run the interview in spec/11-persona-interview.md, then call this. Collect interests and preferences through normal conversation; do NOT collect legal name, home address, or precise location. firstName and contact are optional and stay on the device — shared only after both people approve.",
  {
    hobbies: z.array(z.string()).describe('interests, e.g. ["climbing","board games","coffee"]'),
    activities: z.array(z.enum(ACTIVITY_CLASSES)).optional(),
    timeBands: z.array(z.enum(TIME_BANDS)).optional(),
    energyLevel: z.enum(ENERGY_LEVELS).optional(),
    settingPref: z.enum(SETTING_PREFS).optional(),
    valueTags: z.array(z.string()).optional().describe('vibe, e.g. ["quiet","sober-friendly"]'),
    hardConstraints: z.array(z.string()).optional().describe('e.g. ["no_alcohol"]'),
    groupPref: z.enum(GROUP_PREFS).optional(),
    noveltyPref: z.enum(NOVELTY_PREFS).optional(),
    handle: z.string().optional().describe('a public display name — NOT their real name; shown at the public tier'),
    firstName: z.string().optional().describe('their real first name — stored on device, shared only after both approve'),
    contact: z.string().optional().describe('how to reach them day-of, e.g. "signal:@you" — shared only post-commit'),
    geoCell: z.string().optional().describe('rough neighborhood, e.g. "northside"'),
  },
  async (a) => {
    const draft = validateDraft({
      handle: a.handle?.trim() || `kinweaver-${node.id.slice(0, 6)}`,
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
      firstName: a.firstName ?? '',
      legalName: '',
      homeCoordinate: { lat: 0, lng: 0 },
      contact: a.contact ?? '',
    });
    agent = null; // rebuild with the new profile on next connect
    save();
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

server.tool(
  'kinweave_connections',
  "List the people the user has connected with (arranged a hangout with), their tags, and groups.",
  {},
  async () => {
    const conns = connectionsList(social);
    if (!conns.length) return text('No connections yet. They appear here after you arrange a hangout with someone.');
    const lines = conns.map((c) => {
      const groups = groupsFor(social, c.id).map((g) => g.name);
      const bits = [c.name];
      if (c.tags.length) bits.push(`tags: ${c.tags.join(', ')}`);
      if (groups.length) bits.push(`groups: ${groups.join(', ')}`);
      if (c.lastHangout) bits.push(`last: ${c.lastHangout}`);
      return `• ${bits.join(' — ')}`;
    });
    return text(lines.join('\n'));
  },
);

server.tool(
  'kinweave_tag_connection',
  "Add a tag to a connection (by their name or id). Use to organize people, e.g. 'climbing', 'work', 'close-friend'.",
  { connection: z.string().describe('the connection name or id'), tag: z.string() },
  async ({ connection, tag }) => {
    const c = findConn(connection);
    if (!c) return text(`No connection matching "${connection}".`);
    addTag(social, c.id, tag);
    save();
    return text(`Tagged ${c.name} with "${tag.trim().toLowerCase()}". Tags: ${social.connections[c.id]!.tags.join(', ')}.`);
  },
);

server.tool(
  'kinweave_create_group',
  'Create a group to organize connections, e.g. "Climbing crew".',
  { name: z.string() },
  async ({ name }) => {
    createGroup(social, name, randomUUID());
    save();
    return text(`Created group "${name.trim()}".`);
  },
);

server.tool(
  'kinweave_add_to_group',
  'Add a connection (by name or id) to a group (by name).',
  { connection: z.string(), group: z.string() },
  async ({ connection, group }) => {
    const c = findConn(connection);
    if (!c) return text(`No connection matching "${connection}".`);
    const g = social.groups.find((x) => x.name.toLowerCase() === group.trim().toLowerCase());
    if (!g) return text(`No group named "${group}". Create it first with kinweave_create_group.`);
    setInGroup(social, g.id, c.id, true);
    save();
    return text(`Added ${c.name} to "${g.name}".`);
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write(`kinweave mcp: identity ${node.id}, relay ${RELAY}, home ${HOME}\n`);
