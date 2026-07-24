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
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Node, fingerprint } from '../src/portable/crypto';
import { KinweaveAgent } from '../src/portable/agent';
import { assembleProfile, validateDraft } from '../src/ai/onboarding';
import type { PrivateProfile } from '../src/types/profile';
import { emptyStore, upsertConnection, addTag, createGroup, setInGroup, connectionsList, groupsFor, type SocialStore, type Connection } from '../src/portable/social';
import { CommunityBook, type CommunityBookState } from '../src/portable/community-book';
import { encodeKw1, decodeKw1 } from '../src/portable/invite';

const HOME = process.env.KINWEAVE_HOME ?? join(homedir(), '.kinweave');
const STATE = join(HOME, 'state.json');
const RELAY = process.env.KINWEAVE_RELAY ?? 'ws://127.0.0.1:8788/relay';

interface Persisted {
  keys?: { idSeed: string; encSeed: string };
  profile?: PrivateProfile;
  social?: SocialStore;
  communities?: CommunityBookState;
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
  writeFileSync(STATE, JSON.stringify({ keys: node.exportSeeds(), profile: profile ?? undefined, social, communities: communities.toJSON() }, null, 2));
}

const state = load();
const node = state.keys ? new Node(state.keys) : new Node();
let profile: PrivateProfile | null = state.profile ?? null;
const social: SocialStore = state.social ?? emptyStore();
const communities: CommunityBook = CommunityBook.fromJSON(state.communities ?? {});
let agent: KinweaveAgent | null = null;
if (!state.keys) save();

function ensureAgent(): KinweaveAgent {
  if (!profile) throw new Error('Build your Persona first with kinweave_save_persona.');
  if (!agent) {
    agent = new KinweaveAgent(node, profile, RELAY, (info) => {
      upsertConnection(social, { id: info.id, name: info.name, when: Date.now(), hangout: info.hangout });
      save();
    });
  }
  const active = communities.activeId();
  if (active) agent.setCommunity(active);
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
  'kinweave_create_community',
  'Create a new community (a neighborhood, club, or friend circle) and make it the active board. Returns a join code to share — anyone who joins shares one open-calls board with you.',
  { name: z.string().describe('display name, e.g. "Northside Board Gamers"') },
  async ({ name }) => {
    const c = communities.create({ name: name.trim(), founder: node.identity.pubKey, relays: [RELAY] });
    if (agent) agent.setCommunity(c.descriptor.community.id);
    save();
    return text(`Created "${c.descriptor.community.name}" (${c.descriptor.community.id}) and made it active.\n\nShare this join code so others can join:\n\n${encodeKw1(c.descriptor)}`);
  },
);

server.tool(
  'kinweave_join_community',
  'Join a community using a code someone shared. Makes it the active board if you had none. Verifies the code before joining.',
  { code: z.string() },
  async ({ code }) => {
    const kw = decodeKw1(code.trim());
    if (!kw || kw.kind !== 'community') return text("That doesn't look like a community join code.");
    const r = communities.join(kw, Date.now());
    if (!r.ok) return text("That community code couldn't be verified (it may be invalid or expired).");
    if (agent && communities.activeId() === kw.community.id) agent.setCommunity(kw.community.id);
    save();
    return text(`Joined "${kw.community.name}" (${kw.community.id}).${communities.activeId() === kw.community.id ? ' It is now your active board.' : ' Use kinweave_use_community to switch to it.'}`);
  },
);

server.tool(
  'kinweave_communities',
  'List the communities the user has created or joined, and which one is active (the board their open calls post to and read from).',
  {},
  async () => {
    const active = communities.activeId();
    const rows = communities.list().map((c) => {
      const id = c.descriptor.community.id;
      return `${active === id ? '✓ ' : '• '}${c.descriptor.community.name} — ${c.secret ? 'created by you' : 'joined'} (${id})`;
    });
    const localLine = `${active === null ? '✓ ' : '• '}Local (default) — anyone on this server`;
    return text([localLine, ...rows].join('\n') + '\n\nSwitch with kinweave_use_community.');
  },
);

server.tool(
  'kinweave_use_community',
  "Switch which community is active (by name or id), or pass 'local' for the shared default. Open calls post to and read from the active community.",
  { community: z.string().describe('a community name, id, or "local"') },
  async ({ community }) => {
    const q = community.trim().toLowerCase();
    if (q === 'local') {
      communities.setActive(null);
      if (agent && profile) agent.setCommunity(profile.community);
      save();
      return text('Switched to the Local (default) board.');
    }
    const match = communities.list().find((c) => c.descriptor.community.id === community.trim() || c.descriptor.community.name.toLowerCase() === q);
    if (!match) return text(`No community matching "${community}". List them with kinweave_communities.`);
    const id = match.descriptor.community.id;
    communities.setActive(id);
    if (agent) agent.setCommunity(id);
    save();
    return text(`Switched to "${match.descriptor.community.name}". Your open calls now use this board.`);
  },
);

server.tool(
  'kinweave_post_open_call',
  "Publish a coarse 'open call' to the community board so others can discover the user is up for something. Only PUBLIC coarse details go out — activity, rough time band, neighborhood, group size. No exact time, address, name, or contact. Posting is the user's OK to share this much.",
  {
    activityClass: z.enum(['games', 'food', 'outdoors', 'arts', 'sport', 'learning']),
    timeBand: z.enum(['weekday_day', 'weekday_eve', 'weekend_day', 'weekend_eve']),
    geoCell: z.string().optional().describe('rough neighborhood, e.g. "northside" — defaults to the Persona\'s'),
    groupSize: z.enum(['one_on_one', 'small', 'either']).optional(),
    hours: z.number().optional().describe('how long the call stays live (default 168 = one week)'),
  },
  async (a) => {
    const call = await ensureAgent().postOpenCall(a);
    return text(`Posted your open call: ${call.activityClass} · ${call.timeBand} · ${call.geoCell} · ${call.groupSize}. Others in your community can see and respond to it. Ask me to list open calls to see who's around.`);
  },
);

server.tool(
  'kinweave_list_open_calls',
  "List the open calls other people have posted to the community board, each scored against the user's Persona (great / good / possible match). Use this to find someone to reach out to, then kinweave_respond_to_call.",
  {},
  async () => {
    const calls = await ensureAgent().listCalls();
    if (!calls.length) return text('No open calls on the board right now. You could post one with kinweave_post_open_call.');
    const rank = { high: 0, medium: 1, low: 2 } as const;
    const label = { high: '✨ great match', medium: 'good match', low: 'possible match' } as const;
    const lines = calls
      .sort((x, y) => (rank[x.match?.band ?? 'low'] ?? 3) - (rank[y.match?.band ?? 'low'] ?? 3))
      .map(({ call, match }) => {
        const who = fingerprint(call.pubKey);
        const bits = [`${call.activityClass} · ${call.timeBand} · ${call.geoCell} · ${call.groupSize}`];
        if (match) bits.push(`${label[match.band]} (${match.reasons.join('; ')})`);
        return `• ${bits.join(' — ')}\n  respond with: ${who}`;
      });
    return text(`Open calls:\n${lines.join('\n')}`);
  },
);

server.tool(
  'kinweave_respond_to_call',
  'Respond to someone\'s open call (pass their id from kinweave_list_open_calls). Starts your Personas negotiating; returns the first thing that needs the user\'s approval.',
  { person: z.string().describe('the id shown under an open call') },
  async ({ person }) => {
    const a = ensureAgent();
    await a.respondToCall(person);
    await a.waitForNext();
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
