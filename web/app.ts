/**
 * Kinweave PWA. Keys + profile (Zone O) live in this browser (localStorage);
 * the Persona/Gate/Ledger/driver run here; the server is only an untrusted relay
 * + a Claude proxy. Screens: onboarding -> home -> connect (QR) -> negotiate
 * (consent taps) -> hangout.
 */

import qrcode from 'qrcode-generator';
import { Node, fingerprint, type PresenceBeacon, type OpenCall } from '../src/portable/crypto';
import { makeInvite, inviteUrl, parseKw1FromHash, decodeKw1, encodeKw1, verifyInvite } from '../src/portable/invite';
import { connectRelay, type RelayConn } from '../src/portable/relay-connect';
import { IntentBoardMembership } from '../src/portable/intent-connect';
import { matchCall, type CallMatch } from '../src/core/call-match';
import { CommunityBook } from '../src/portable/community-book';
import { verifyCommunity, type CommunityDescriptorV1 } from '../src/portable/community';
import { Session } from '../src/portable/session';
import { NegotiationDriver } from '../src/core/negotiation-driver';
import { Persona } from '../src/persona/persona';
import { Clock } from '../src/core/clock';
import { approveAll } from '../src/persona/owner';
import { assembleProfile, validateDraft } from '../src/ai/onboarding';
import type { ProfileDraft, ProfileSecrets } from '../src/ai/types';
import type { PrivateProfile } from '../src/types/profile';
import type { GateRequest } from '../src/persona/owner';
import type { ProposedHangout } from '../src/types/artifact';
import type { DriverTerminal } from '../src/types/negotiation';
import { PROVIDERS, type ProviderConfig } from '../src/ai/provider-list';
import { emptyStore, upsertConnection, renameConnection, addTag, removeTag, deleteConnection, createGroup, deleteGroup, setInGroup, connectionsList, type SocialStore } from '../src/portable/social';

// ---- storage (Zone O stays here) ------------------------------------------

const LS = window.localStorage;
function loadNode(): Node {
  const s = LS.getItem('kw_keys');
  if (s) return new Node(JSON.parse(s));
  const n = new Node();
  LS.setItem('kw_keys', JSON.stringify(n.exportSeeds()));
  return n;
}
const loadProfile = (): PrivateProfile | null => JSON.parse(LS.getItem('kw_profile') ?? 'null');
const saveProfile = (p: PrivateProfile) => LS.setItem('kw_profile', JSON.stringify(p));
const getProvider = (): ProviderConfig | null => JSON.parse(LS.getItem('kw_provider') ?? 'null');
const saveProvider = (c: ProviderConfig) => LS.setItem('kw_provider', JSON.stringify(c));
const aiLabel = () => {
  const p = getProvider();
  return p?.apiKey ? PROVIDERS[p.provider]?.label ?? p.provider : "the app's AI";
};
const loadSocial = (): SocialStore => JSON.parse(LS.getItem('kw_social') ?? 'null') ?? emptyStore();
const saveSocial = (s: SocialStore) => LS.setItem('kw_social', JSON.stringify(s));
const loadCommunities = (): CommunityBook => CommunityBook.fromJSON(JSON.parse(LS.getItem('kw_communities') ?? '{}'));
const saveCommunities = (b: CommunityBook) => LS.setItem('kw_communities', JSON.stringify(b.toJSON()));
/** The community the boards key on: the active one, else the shared in-person 'local'. */
const activeCommunityId = (): string => loadCommunities().activeId() ?? 'local';
const activeCommunityName = (): string => loadCommunities().active()?.descriptor.community.name ?? 'Local (default)';

// ---- tiny DOM helpers -----------------------------------------------------

const root = () => document.getElementById('app')!;
function el(tag: string, attrs: Record<string, string> = {}, ...kids: (Node | string)[]): HTMLElement {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  for (const kid of kids) e.append(kid);
  return e;
}
function screen(...kids: (Node | string)[]) {
  const r = root();
  r.innerHTML = '';
  for (const k of kids) r.append(k);
}
const relayUrl = () => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/relay`;
const rid = () => {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
};

// ---- onboarding (Claude chat) ---------------------------------------------

async function onboarding(node: Node) {
  const history: { role: 'user' | 'assistant'; content: string }[] = [];
  const log = el('div', { class: 'card log' });
  const input = el('input', { placeholder: 'Tell me what you enjoy…' }) as HTMLInputElement;

  const bubble = (role: 'me' | 'ai', text: string) => {
    log.append(el('div', { class: `bubble ${role}` }, text));
    log.scrollTop = log.scrollHeight;
  };
  bubble('ai', "Hi! I'm your Kinweave guide. Tell me a bit about what you like doing and who you'd enjoy meeting — I'll build your Persona.");

  const send = async () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    history.push({ role: 'user', content: text });
    bubble('me', text);
    try {
      const r = await fetch('/api/onboard', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: history, provider: getProvider() ?? undefined }) });
      if (r.status === 501) return bubble('ai', 'No AI is set up yet. Tap the "AI:" button above to pick a provider (or use your Claude subscription), or tap "Build my Persona" for the quick form.');
      const { reply } = await r.json();
      history.push({ role: 'assistant', content: reply });
      bubble('ai', reply);
    } catch {
      bubble('ai', "(couldn't reach the server — check it's running)");
    }
  };

  const buildBtn = el('button', {}, 'Build my Persona ✓');
  buildBtn.onclick = async () => {
    let draft: ProfileDraft | null = null;
    try {
      const r = await fetch('/api/extract', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: history, provider: getProvider() ?? undefined }) });
      if (r.ok) draft = validateDraft((await r.json()).draft);
    } catch {
      /* fall through to manual form */
    }
    secretsForm(node, draft);
  };

  const inputRow = el('div', { class: 'row' });
  const sendBtn = el('button', {}, 'Send');
  sendBtn.onclick = send;
  input.onkeydown = (e) => {
    if ((e as KeyboardEvent).key === 'Enter') send();
  };
  inputRow.append(input, sendBtn);

  const aiBtn = el('button', { class: 'ghost' }, `AI: ${aiLabel()} · change`);
  aiBtn.onclick = () => providerScreen(node);

  // Import a draft an AI built elsewhere (e.g. it read the repo and ran the spec/11 interview).
  const importBtn = el('button', { class: 'ghost' }, 'Paste a profile my AI built →');
  importBtn.onclick = () => importDraft(node);

  screen(el('h1', {}, 'Build your Persona'), aiBtn, log, inputRow, buildBtn, importBtn);
}

// ---- import a ready-made ProfileDraft (from an AI that read the repo) ------

function importDraft(node: Node) {
  const box = el('textarea', { placeholder: '{ "handle": "...", "hobbyTags": [...], ... }', rows: '10' }) as HTMLTextAreaElement;
  const err = el('div', { class: 'muted' }, '');
  const go = el('button', {}, 'Use this profile ✓');
  go.onclick = () => {
    let draft: ProfileDraft;
    try {
      draft = validateDraft(JSON.parse(box.value));
    } catch (e) {
      err.textContent = `Couldn't read that: ${(e as Error).message}`;
      return;
    }
    secretsForm(node, draft); // reuse the normal local-secrets + assemble flow
  };
  screen(
    el('h1', {}, 'Import a built profile'),
    el('p', { class: 'muted' }, 'If you had your own AI build a Kinweave profile from the repo, paste its JSON here. Nothing sensitive — your name and contact stay on this device, added on the next screen.'),
    box,
    err,
    go,
    backBtn(() => onboarding(node)),
  );
}

// ---- AI provider settings -------------------------------------------------

function backBtn(fn: () => void): HTMLElement {
  const b = el('button', { class: 'ghost' }, 'Back');
  b.onclick = fn;
  return b;
}

function providerScreen(node: Node) {
  const cur = getProvider();
  const list = el('div', {});
  for (const [id, p] of Object.entries(PROVIDERS)) {
    const b = el('button', { class: cur?.provider === id ? '' : 'ghost' }, p.label);
    b.onclick = () => keyForm(node, id);
    list.append(b);
  }
  const useDefault = el('button', { class: 'ghost' }, "Use the app's built-in AI (if the host set one)");
  useDefault.onclick = () => {
    LS.removeItem('kw_provider');
    onboarding(node);
  };
  const sub = el('button', { class: 'ghost' }, 'Only have a Claude subscription? →');
  sub.onclick = () => connectorInfo(node);
  screen(
    el('h1', {}, 'Choose your AI'),
    el('p', { class: 'muted' }, 'This builds your Persona from your chat. Your key is stored on your phone and sent only to your Kinweave server.'),
    list,
    useDefault,
    sub,
    backBtn(() => onboarding(node)),
  );
}

function keyForm(node: Node, id: string) {
  const p = PROVIDERS[id]!;
  const cur = getProvider();
  const key = el('input', { placeholder: p.keyHint, type: 'password' }) as HTMLInputElement;
  key.value = cur?.provider === id ? cur.apiKey : '';
  const model = el('input', { placeholder: `model (default: ${p.defaultModel})` }) as HTMLInputElement;
  const base = el('input', { placeholder: `base URL (default: ${p.baseURL})` }) as HTMLInputElement;
  const save = el('button', {}, 'Save & use');
  save.onclick = () => {
    saveProvider({ provider: id, apiKey: key.value.trim(), model: model.value.trim() || undefined, baseURL: base.value.trim() || undefined });
    onboarding(node);
  };
  screen(
    el('h1', {}, p.label),
    el('p', { class: 'muted' }, 'Paste your API key. Model and base URL are optional — leave blank for the defaults.'),
    key,
    model,
    base,
    save,
    backBtn(() => providerScreen(node)),
  );
}

function connectorInfo(node: Node) {
  screen(
    el('h1', {}, 'Use your Claude subscription'),
    el('p', { class: 'muted' }, "A Claude subscription can't power a website directly — but you can run Kinweave INSIDE Claude. Add the Kinweave connector to Claude Desktop or Claude Code and just chat with your own Claude. Setup guide:"),
    el('div', { class: 'link' }, 'github.com/SpreitzerJacobGit/kinweave/blob/master/mcp/README.md'),
    backBtn(() => providerScreen(node)),
  );
}

// ---- secrets form (local; never sent to the LLM) --------------------------

function secretsForm(node: Node, draft: ProfileDraft | null) {
  const f = (id: string, ph: string, val = '') => {
    const i = el('input', { placeholder: ph, value: val }) as HTMLInputElement;
    i.id = id;
    return i;
  };
  const firstName = f('firstName', 'First name (shared only after you both agree)');
  const contact = f('contact', 'How to reach you day-of (e.g. signal:@you)');

  // Minimal manual draft if Claude extraction was unavailable.
  const hobbies = f('hobbies', 'Your interests, comma-separated', (draft?.hobbyTags ?? []).join(', '));
  const activities = el('select', {}) as HTMLSelectElement;
  for (const a of ['games', 'food', 'outdoors', 'arts', 'sport', 'learning']) activities.append(el('option', { value: a }, a));
  if (draft?.activityClasses?.[0]) activities.value = draft.activityClasses[0];

  const save = el('button', {}, 'Save my Persona');
  save.onclick = () => {
    const hobbyTags = hobbies.value.split(',').map((s) => s.trim()).filter(Boolean);
    const base: ProfileDraft =
      draft ??
      validateDraft({
        handle: firstName.value || 'me',
        community: 'local',
        hobbyTags,
        geoCell: 'nearby',
        valueTags: [],
        availabilityMask: 15,
        groupPref: 'either',
        activityClasses: [activities.value],
        energyLevel: 'medium',
        timeBands: ['weekend_day', 'weekend_eve'],
        settingPref: 'public_venue',
        hardConstraints: [],
        noveltyPref: 'either',
      });
    // In-person pairing uses a shared "local" community so any two people can meet.
    base.community = 'local';
    if (hobbyTags.length) base.hobbyTags = hobbyTags;

    const secrets: ProfileSecrets = {
      ownerId: node.id,
      firstName: firstName.value || 'Someone',
      legalName: '',
      homeCoordinate: { lat: 0, lng: 0 },
      contact: contact.value || 'ask in person',
    };
    saveProfile(assembleProfile(base, secrets));
    // If they arrived from an invite link, connect to the inviter now.
    const pending = sessionStorage.getItem('kw_pair');
    if (pending) {
      sessionStorage.removeItem('kw_pair');
      const kw = decodeKw1(pending);
      if (kw && kw.kind === 'invite' && verifyInvite(kw)) return startConnect(node, loadProfile()!, kw.beacon);
    }
    home(node);
  };

  screen(
    el('h1', {}, 'A few private details'),
    el('p', { class: 'muted' }, 'These stay on your phone. Your first name and contact are shared only after you both approve.'),
    ...(draft ? [] : [el('h2', {}, 'Your interests'), hobbies, activities]),
    el('h2', {}, 'Private'),
    firstName,
    contact,
    save,
  );
}

// ---- home -----------------------------------------------------------------

function home(node: Node) {
  const p = loadProfile();
  if (!p) return onboarding(node);
  const tags = el('div', {});
  for (const t of p.hobbyTags) tags.append(el('span', { class: 'pill' }, t));

  const connect = el('button', {}, '🔗 Connect / invite someone');
  connect.onclick = () => connectScreen(node, p);
  const board = el('button', {}, '📣 Open calls');
  board.onclick = () => intentBoardScreen(node, p);
  const communities = el('button', { class: 'ghost' }, `🏘️ Communities · ${activeCommunityName()}`);
  communities.onclick = () => communitiesScreen(node, p);
  const dash = el('button', { class: 'ghost' }, '👥 Connections');
  dash.onclick = () => connectionsScreen(node);
  const reset = el('button', { class: 'ghost' }, 'Start over');
  reset.onclick = () => {
    LS.removeItem('kw_profile');
    onboarding(node);
  };

  const count = connectionsList(loadSocial()).length;
  screen(
    el('h1', {}, `You're set, ${p.firstName}`),
    el('div', { class: 'card' }, el('div', { class: 'muted' }, 'Your interests'), tags),
    el('p', { class: 'muted' }, 'Meet someone by scanning their code in person, or send them an invite link.'),
    connect,
    board,
    communities,
    dash,
    ...(count ? [el('p', { class: 'muted' }, `${count} connection${count === 1 ? '' : 's'}`)] : []),
    reset,
  );
}

// ---- open calls: the intent board (browse + post + digest) ----------------

const TIME_BANDS = ['weekday_day', 'weekday_eve', 'weekend_day', 'weekend_eve'];
const ACTIVITY_CLASSES = ['games', 'food', 'outdoors', 'arts', 'sport', 'learning'];
const GROUP_SIZES: OpenCall['groupSize'][] = ['one_on_one', 'small', 'either'];
const BAND_LABEL: Record<CallMatch['band'], string> = { high: '✨ great match', medium: '· good match', low: '· possible match' };
const prettyBand = (b: string) => b.replace(/_/g, ' ');

async function intentBoardScreen(node: Node, profile: PrivateProfile) {
  const community = activeCommunityId();
  const membership = new IntentBoardMembership(node, relayUrl(), community);
  let calls: OpenCall[] = [];

  const forYou = el('div', {});
  const others = el('div', {});
  const status = el('p', { class: 'muted' }, 'Loading the board…');

  // Turning a call into a hangout reuses the gated negotiation — so close the
  // board subscription first (one socket per fingerprint on the relay).
  const respond = (call: OpenCall) => {
    membership.close();
    startConnectPeer(node, profile, { pubKey: call.pubKey, encPubKey: call.encPubKey });
  };

  const callCard = (call: OpenCall, match: CallMatch | null) => {
    const card = el('div', { class: 'card' });
    card.append(
      el('div', {}, `${prettyBand(call.activityClass)} · ${prettyBand(call.timeBand)}`),
      el('div', { class: 'muted' }, `📍 ${call.geoCell} · ${prettyBand(call.groupSize)}`),
    );
    if (match) card.append(el('div', { class: 'muted' }, `${BAND_LABEL[match.band]} — ${match.reasons.join('; ')}`));
    const btn = el('button', {}, 'Respond');
    btn.onclick = () => respond(call);
    card.append(btn);
    return card;
  };

  const render = () => {
    // The digest: calls that match the owner's profile, ranked; then everything else.
    const rank = { high: 3, medium: 2, low: 1 } as const;
    const matched = calls
      .map((c) => ({ call: c, match: matchCall(c, profile) }))
      .filter((x): x is { call: OpenCall; match: CallMatch } => x.match !== null)
      .sort((a, b) => rank[b.match.band] - rank[a.match.band]);
    const matchedKeys = new Set(matched.map((m) => m.call.pubKey));
    const rest = calls.filter((c) => !matchedKeys.has(c.pubKey));

    forYou.innerHTML = '';
    forYou.append(el('h2', {}, '✨ For you'));
    if (!matched.length) forYou.append(el('p', { class: 'muted' }, 'No calls match your interests yet.'));
    for (const m of matched) forYou.append(callCard(m.call, m.match));

    others.innerHTML = '';
    others.append(el('h2', {}, 'All open calls'));
    if (!rest.length) others.append(el('p', { class: 'muted' }, calls.length ? '(all shown above)' : 'Nobody has posted a call yet. Be the first!'));
    for (const c of rest) others.append(callCard(c, null));

    status.textContent = `${calls.length} open call${calls.length === 1 ? '' : 's'} on the board.`;
  };

  const post = el('button', {}, '📣 Post an open call');
  post.onclick = () => postCallScreen(node, profile);
  const back = el('button', { class: 'ghost' }, 'Back');
  back.onclick = () => {
    membership.close();
    home(node);
  };

  screen(
    el('h1', {}, 'Open calls'),
    el('p', { class: 'muted' }, `Community: ${activeCommunityName()}. What people are up for — only coarse details are public; your exact time, place, and contact stay private until you both say yes.`),
    post,
    status,
    forYou,
    others,
    back,
  );

  try {
    await membership.join({
      onCalls: (cs) => {
        calls = cs;
        render();
      },
    });
  } catch {
    status.textContent = "(couldn't reach the board — check the server is running)";
  }
}

function postCallScreen(node: Node, profile: PrivateProfile) {
  const sel = (id: string, opts: string[], val: string) => {
    const s = el('select', {}) as HTMLSelectElement;
    s.id = id;
    for (const o of opts) s.append(el('option', { value: o }, prettyBand(o)));
    if (opts.includes(val)) s.value = val;
    return s;
  };
  const activity = sel('activity', ACTIVITY_CLASSES, profile.activityClasses[0] ?? 'games');
  const time = sel('time', TIME_BANDS, profile.timeBands[0] ?? 'weekend_day');
  const group = sel('group', GROUP_SIZES, profile.groupPref);
  const geo = el('input', { value: profile.geoCell, placeholder: 'neighborhood (e.g. northside)' }) as HTMLInputElement;
  const life = sel('life', ['today', 'this week'], 'this week');

  const publish = el('button', {}, 'Publish to the board');
  publish.onclick = () => {
    const HOUR = 3_600_000;
    const expiry = Date.now() + (life.value === 'today' ? 24 * HOUR : 7 * 24 * HOUR);
    const community = activeCommunityId();
    const call = node.openCall({
      community,
      activityClass: activity.value,
      timeBand: time.value,
      geoCell: geo.value.trim() || profile.geoCell,
      groupSize: group.value as OpenCall['groupSize'],
      expiry,
      nonce: rid(),
    });
    // Post over a short-lived membership, then return to the board to see it live.
    const m = new IntentBoardMembership(node, relayUrl(), community);
    void m.join({ call }).then(() => {
      setTimeout(() => {
        m.close();
        intentBoardScreen(node, profile);
      }, 300);
    });
  };

  screen(
    el('h1', {}, 'Post an open call'),
    el('p', { class: 'muted' }, 'This publishes only coarse, public details — activity, rough time, neighborhood, group size. No exact time, address, name, or contact. Publishing is your OK to share this much.'),
    el('h2', {}, 'Activity'),
    activity,
    el('h2', {}, 'Rough time'),
    time,
    el('h2', {}, 'Neighborhood'),
    geo,
    el('h2', {}, 'Group size'),
    group,
    el('h2', {}, 'Show it for'),
    life,
    publish,
    backBtn(() => intentBoardScreen(node, profile)),
  );
}

// ---- communities: create / join / switch / share --------------------------

function communitiesScreen(node: Node, profile: PrivateProfile) {
  const book = loadCommunities();
  const list = el('div', {});

  const row = (title: string, sub: string, active: boolean, actions: HTMLElement[]) => {
    const card = el('div', { class: 'card' });
    card.append(el('div', {}, `${active ? '✓ ' : ''}${title}`), el('div', { class: 'muted' }, sub));
    const bar = el('div', { class: 'row' });
    for (const a of actions) bar.append(a);
    card.append(bar);
    return card;
  };

  // The shared in-person default.
  const useLocal = el('button', { class: 'ghost' }, 'Use');
  useLocal.onclick = () => {
    const b = loadCommunities();
    b.setActive(null);
    saveCommunities(b);
    communitiesScreen(node, profile);
  };
  list.append(row('Local (default)', 'Anyone on this server — good for in-person meetups.', book.activeId() === null, book.activeId() === null ? [] : [useLocal]));

  for (const c of book.list()) {
    const id = c.descriptor.community.id;
    const active = book.activeId() === id;
    const actions: HTMLElement[] = [];
    if (!active) {
      const use = el('button', { class: 'ghost' }, 'Use');
      use.onclick = () => {
        const b = loadCommunities();
        b.setActive(id);
        saveCommunities(b);
        communitiesScreen(node, profile);
      };
      actions.push(use);
    }
    const share = el('button', { class: 'ghost' }, 'Share');
    share.onclick = () => shareCommunityScreen(node, profile, c.descriptor);
    actions.push(share);
    const leave = el('button', { class: 'ghost' }, 'Leave');
    leave.onclick = () => {
      const b = loadCommunities();
      b.remove(id);
      saveCommunities(b);
      communitiesScreen(node, profile);
    };
    actions.push(leave);
    const tag = c.secret ? 'you created this' : 'joined';
    list.append(row(c.descriptor.community.name, `${tag} · ${id}`, active, actions));
  }

  const create = el('button', {}, '➕ Create a community');
  create.onclick = () => createCommunityScreen(node, profile);
  const join = el('button', {}, '🔗 Join by code');
  join.onclick = () => joinByCodeScreen(node, profile);

  screen(
    el('h1', {}, 'Communities'),
    el('p', { class: 'muted' }, 'A community scopes your open-calls board to a group — a neighborhood, a club, a friend circle. The active one is where your board posts and reads.'),
    list,
    create,
    join,
    backBtn(() => home(node)),
  );
}

function createCommunityScreen(node: Node, profile: PrivateProfile) {
  const name = el('input', { placeholder: 'Community name (e.g. Northside Board Gamers)' }) as HTMLInputElement;
  const make = el('button', {}, 'Create & make active');
  make.onclick = () => {
    if (!name.value.trim()) return;
    const b = loadCommunities();
    // The founder is seeded as the first trust root; relays carry the current server.
    const c = b.create({ name: name.value.trim(), founder: node.identity.pubKey, relays: [relayUrl()] });
    saveCommunities(b);
    shareCommunityScreen(node, profile, c.descriptor);
  };
  screen(
    el('h1', {}, 'Create a community'),
    el('p', { class: 'muted' }, "A community is just a keypair — no server owns it. You'll get a join code to share. You keep the key that can update it."),
    name,
    make,
    backBtn(() => communitiesScreen(node, profile)),
  );
}

function joinByCodeScreen(node: Node, profile: PrivateProfile) {
  const input = el('textarea', { placeholder: 'Paste a join code or the full link', rows: '4', style: 'width:100%' }) as HTMLTextAreaElement;
  const status = el('p', { class: 'muted' }, '');
  const join = el('button', {}, 'Join');
  join.onclick = () => {
    const raw = input.value.trim();
    const kw = parseKw1FromHash(raw.includes('kw1=') ? raw : `#kw1=${raw}`) ?? decodeKw1(raw);
    if (!kw || kw.kind !== 'community') {
      status.textContent = "That doesn't look like a community join code.";
      return;
    }
    const b = loadCommunities();
    const r = b.join(kw as CommunityDescriptorV1, Date.now());
    if (!r.ok) {
      status.textContent = "That community code couldn't be verified (it may be invalid or expired).";
      return;
    }
    saveCommunities(b);
    communitiesScreen(node, profile);
  };
  screen(
    el('h1', {}, 'Join a community'),
    el('p', { class: 'muted' }, 'Paste the code someone shared (or open their link directly). Joining is public — only your open calls are shared, and only coarsely.'),
    input,
    join,
    status,
    backBtn(() => communitiesScreen(node, profile)),
  );
}

function shareCommunityScreen(node: Node, profile: PrivateProfile, descriptor: CommunityDescriptorV1) {
  const link = inviteUrl(location.origin, descriptor);
  const qr = qrcode(0, 'M');
  qr.addData(link);
  qr.make();
  const qrBox = el('div', { class: 'qr' });
  qrBox.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 1 });

  const status = el('p', { class: 'muted' }, '');
  const share = el('button', {}, '📨 Send join link');
  share.onclick = async () => {
    try {
      await (navigator as unknown as { share: (d: { title: string; text: string; url: string }) => Promise<void> }).share({ title: `Join ${descriptor.community.name} on Kinweave`, text: `Join ${descriptor.community.name}`, url: link });
    } catch {
      try {
        await navigator.clipboard?.writeText(link);
        status.textContent = 'Link copied — send it to your people.';
      } catch {
        /* ignore */
      }
    }
  };
  screen(
    el('h1', {}, descriptor.community.name),
    el('p', { class: 'muted' }, 'Others scan this (or open the link) to join. Everyone who joins shares one open-calls board.'),
    el('div', { style: 'text-align:center' }, qrBox),
    share,
    el('div', { class: 'link' }, link),
    status,
    backBtn(() => communitiesScreen(node, profile)),
  );
}

// ---- dashboard: connections, tags, groups ---------------------------------

function connectionsScreen(node: Node) {
  const conns = connectionsList(loadSocial());
  const list = el('div', {});
  if (!conns.length) list.append(el('p', { class: 'muted' }, 'No connections yet. Someone shows up here after you arrange a hangout with them.'));
  for (const c of conns) {
    const row = el('div', { class: 'card' });
    row.style.cursor = 'pointer';
    const tags = el('div', {});
    for (const t of c.tags) tags.append(el('span', { class: 'pill' }, t));
    row.append(el('div', {}, c.name), ...(c.lastHangout ? [el('div', { class: 'muted' }, c.lastHangout)] : []), tags);
    row.onclick = () => connectionDetail(node, c.id);
    list.append(row);
  }
  const groups = el('button', { class: 'ghost' }, '📁 Groups');
  groups.onclick = () => groupsScreen(node);
  screen(el('h1', {}, 'Your connections'), list, groups, backBtn(() => home(node)));
}

function connectionDetail(node: Node, id: string) {
  const c0 = loadSocial().connections[id];
  if (!c0) return connectionsScreen(node);

  const name = el('input', { value: c0.name }) as HTMLInputElement;
  name.onchange = () => {
    const s = loadSocial();
    renameConnection(s, id, name.value);
    saveSocial(s);
  };

  const tagsWrap = el('div', {});
  const renderTags = () => {
    tagsWrap.innerHTML = '';
    for (const t of loadSocial().connections[id]?.tags ?? []) {
      const pill = el('span', { class: 'pill' }, `${t} ✕`);
      pill.style.cursor = 'pointer';
      pill.onclick = () => {
        const s = loadSocial();
        removeTag(s, id, t);
        saveSocial(s);
        renderTags();
      };
      tagsWrap.append(pill);
    }
  };
  renderTags();
  const tagInput = el('input', { placeholder: 'add a tag (e.g. climbing) + Enter' }) as HTMLInputElement;
  tagInput.onkeydown = (e) => {
    if ((e as KeyboardEvent).key === 'Enter' && tagInput.value.trim()) {
      const s = loadSocial();
      addTag(s, id, tagInput.value);
      saveSocial(s);
      tagInput.value = '';
      renderTags();
    }
  };

  const groupsWrap = el('div', {});
  const s0 = loadSocial();
  if (!s0.groups.length) groupsWrap.append(el('p', { class: 'muted' }, 'No groups yet — make one in Groups.'));
  for (const g of s0.groups) {
    const label = el('label', { style: 'display:flex;align-items:center;gap:8px;margin:4px 0' });
    const cb = el('input', { type: 'checkbox' }) as HTMLInputElement;
    cb.checked = g.members.includes(id);
    cb.onchange = () => {
      const s = loadSocial();
      setInGroup(s, g.id, id, cb.checked);
      saveSocial(s);
    };
    label.append(cb, ` ${g.name}`);
    groupsWrap.append(label);
  }

  const del = el('button', { class: 'danger' }, 'Delete connection');
  del.onclick = () => {
    const s = loadSocial();
    deleteConnection(s, id);
    saveSocial(s);
    connectionsScreen(node);
  };

  screen(
    el('h1', {}, 'Connection'),
    el('div', { class: 'muted' }, 'Name'),
    name,
    el('h2', {}, 'Tags'),
    tagsWrap,
    tagInput,
    el('h2', {}, 'Groups'),
    groupsWrap,
    del,
    backBtn(() => connectionsScreen(node)),
  );
}

function groupsScreen(node: Node) {
  const s = loadSocial();
  const list = el('div', {});
  if (!s.groups.length) list.append(el('p', { class: 'muted' }, 'No groups yet.'));
  for (const g of s.groups) {
    const row = el('div', { class: 'card' });
    const members = g.members.map((m) => s.connections[m]?.name ?? '?').join(', ');
    row.append(el('div', {}, `${g.name} (${g.members.length})`), el('div', { class: 'muted' }, members || 'no members yet'));
    const rm = el('button', { class: 'ghost' }, 'Delete group');
    rm.onclick = () => {
      const st = loadSocial();
      deleteGroup(st, g.id);
      saveSocial(st);
      groupsScreen(node);
    };
    row.append(rm);
    list.append(row);
  }
  const newName = el('input', { placeholder: 'New group name (e.g. Climbing crew)' }) as HTMLInputElement;
  const add = el('button', {}, 'Create group');
  add.onclick = () => {
    if (!newName.value.trim()) return;
    const st = loadSocial();
    createGroup(st, newName.value, rid());
    saveSocial(st);
    groupsScreen(node);
  };
  screen(el('h1', {}, 'Groups'), list, el('h2', {}, 'New group'), newName, add, backBtn(() => connectionsScreen(node)));
}

// ---- connect (show QR; wait as responder) ---------------------------------

async function connectScreen(node: Node, profile: PrivateProfile) {
  const invite = makeInvite(node, { hobbyTags: profile.hobbyTags, geoCell: profile.geoCell, community: activeCommunityId() });
  const link = inviteUrl(location.origin, invite);

  const qr = qrcode(0, 'M');
  qr.addData(link);
  qr.make();
  const qrBox = el('div', { class: 'qr' });
  qrBox.innerHTML = qr.createSvgTag({ cellSize: 5, margin: 1 });

  const status = el('p', { class: 'muted' }, 'Waiting for them to open the link…');
  const share = el('button', {}, '📨 Send invite link');
  share.onclick = async () => {
    try {
      await (navigator as unknown as { share: (d: { title: string; text: string; url: string }) => Promise<void> }).share({ title: 'Kinweave', text: 'Connect with me on Kinweave', url: link });
    } catch {
      try {
        await navigator.clipboard?.writeText(link);
        status.textContent = 'Link copied — paste it to your friend.';
      } catch {
        /* ignore */
      }
    }
  };
  const back = el('button', { class: 'ghost' }, 'Back');
  back.onclick = () => home(node);

  screen(
    el('h1', {}, 'Invite someone'),
    el('p', { class: 'muted' }, 'In person, they scan this. Far away, send the link — it works even if you open it at different times.'),
    el('div', { style: 'text-align:center' }, qrBox),
    share,
    el('div', { class: 'link' }, link),
    status,
    back,
  );

  // Listen as responder: build the session on the first inbound envelope.
  runSession(node, profile, { role: 'responder', onFirst: () => (status.textContent = 'Connected — your Personas are talking…') });
}

// ---- pair (scanner = initiator) -------------------------------------------

function startConnect(node: Node, profile: PrivateProfile, beacon: PresenceBeacon) {
  startConnectPeer(node, profile, { pubKey: beacon.pubKey, encPubKey: beacon.encPubKey });
}

/** Begin a negotiation as initiator against a peer identified by their keys (e.g. from an OpenCall). */
function startConnectPeer(node: Node, profile: PrivateProfile, peer: { pubKey: string; encPubKey: string }) {
  runSession(node, profile, {
    role: 'initiator',
    peer,
    counterpartFp: fingerprint(peer.pubKey),
  });
}

function tryPair(node: Node): boolean {
  const kw = parseKw1FromHash(location.hash);
  if (!kw) return false;
  history.replaceState(null, '', location.pathname); // don't re-trigger on refresh
  if (kw.kind === 'community') {
    // A "join this network" link. Verify, offer to join, then land on the board.
    const valid = verifyCommunity(kw, Date.now());
    const p0 = loadProfile();
    const back = () => (p0 ? home(node) : onboarding(node));
    if (!valid) {
      screen(el('h1', {}, 'Invalid community link'), el('p', { class: 'muted' }, "That community code couldn't be verified (it may be tampered or expired)."), backBtn(back));
      return true;
    }
    const join = el('button', {}, `Join ${kw.community.name}`);
    join.onclick = () => {
      const b = loadCommunities();
      b.join(kw, Date.now());
      saveCommunities(b);
      p0 ? intentBoardScreen(node, p0) : onboarding(node);
    };
    const cancel = el('button', { class: 'ghost' }, 'Not now');
    cancel.onclick = back;
    screen(
      el('h1', {}, 'Join this community?'),
      el('p', { class: 'muted' }, `${kw.community.name} — you'll share one open-calls board with everyone who joins. Only coarse call details are public.`),
      join,
      cancel,
    );
    return true;
  }
  if (kw.kind !== 'invite' || !verifyInvite(kw)) {
    screen(el('h1', {}, 'Invalid link'), el('p', { class: 'muted' }, "That connect link couldn't be verified. Ask them to send a fresh one."));
    return true;
  }
  const beacon = kw.beacon;
  const p = loadProfile();
  if (!p) {
    // Brand-new person: build a Persona first, then auto-connect to the inviter.
    sessionStorage.setItem('kw_pair', encodeKw1(kw));
    onboarding(node);
    return true;
  }
  const start = el('button', {}, 'Connect');
  start.onclick = () => startConnect(node, p, beacon);
  const cancel = el('button', { class: 'ghost' }, 'Not now');
  cancel.onclick = () => home(node);
  screen(el('h1', {}, 'Connect with them?'), el('p', { class: 'muted' }, 'Their interests: ' + beacon.hobbyTags.join(', ')), start, cancel);
  return true;
}

// ---- the negotiation, with consent taps -----------------------------------

interface RunOpts {
  role: 'initiator' | 'responder';
  peer?: { pubKey: string; encPubKey: string };
  counterpartFp?: string;
  onFirst?: () => void;
}

async function runSession(node: Node, profile: PrivateProfile, opts: RunOpts) {
  let session: Session | null = null;
  let conn: RelayConn;
  let cpName = '';
  let cpFp = opts.counterpartFp ?? '';

  const build = (peer: { pubKey: string; encPubKey: string }, fp: string) => {
    cpFp = fp;
    const persona = new Persona(profile, fp, approveAll, new Clock(), {});
    const driver = new NegotiationDriver(persona, fp, opts.role);
    return new Session(node, driver, peer, {
      send: (env) => conn.send(env),
      onGateRequest: (req) => renderGate(node, req, (d) => session!.resolveGate(d)),
      onMessage: (m) => {
        const fn = (m.payload as Record<string, unknown>).firstName;
        if (m.type === 'DISCLOSE' && typeof fn === 'string') cpName = fn;
      },
      onTerminal: (t) => {
        if (t.outcome === 'committed' && cpFp) {
          const s = loadSocial();
          upsertConnection(s, { id: cpFp, name: cpName, when: Date.now(), hangout: t.artifact ? hangoutSummary(t.artifact) : undefined });
          saveSocial(s);
        }
        renderTerminal(node, t);
      },
    });
  };

  conn = await connectRelay(relayUrl(), node.identity, (env) => {
    if (!session && opts.role === 'responder') {
      opts.onFirst?.();
      session = build({ pubKey: env.from, encPubKey: env.fromEnc }, fingerprint(env.from));
    }
    session?.onEnvelope(env);
  });

  if (opts.role === 'initiator') {
    negotiating();
    session = build(opts.peer!, opts.counterpartFp!);
    session.start();
  }
}

function negotiating() {
  screen(el('h1', {}, 'Your Personas are talking…'), el('p', { class: 'muted' }, 'They compare notes and plan something. You approve every step.'));
}

const GATE_COPY: Record<string, (r: GateRequest) => string> = {
  G1: () => 'Connect with this person and let your Personas talk?',
  G2: () => 'Start sharing your general preferences (activities, times)?',
  G3: (r) => (r.tierTo === 4 ? 'Release your contact info so you can actually meet?' : `Share these details: ${(r.fields ?? []).join(', ')}?`),
  G4: () => 'Approve this hangout?',
};

function renderGate(node: Node, req: GateRequest, resolve: (d: { approve: boolean }) => void) {
  if (req.gate === 'G4' && req.artifact) return renderHangout(node, req.artifact, resolve);
  const yes = el('button', {}, 'Approve');
  yes.onclick = () => {
    negotiating();
    resolve({ approve: true });
  };
  const no = el('button', { class: 'ghost' }, 'Not now');
  no.onclick = () => resolve({ approve: false });
  screen(el('h1', {}, 'Your OK?'), el('div', { class: 'card' }, GATE_COPY[req.gate]?.(req) ?? 'Approve this step?'), yes, no);
}

function renderHangout(node: Node, art: ProposedHangout, resolve: (d: { approve: boolean }) => void) {
  const r = art.compatibilityRationale;
  const plan = art.plan;
  const card = el('div', { class: 'card' },
    el('h2', {}, plan.activity.specific || plan.activity.class),
    el('div', {}, `📍 ${plan.place.name ?? plan.place.type} ${plan.place.isPublic ? '(public)' : ''}`),
    el('div', {}, `🗓️ ${plan.time?.date ?? ''} ${plan.time?.start ?? ''}`),
    el('div', { class: 'muted' }, `Match: ${r.label} — ${r.honestCaveats.join(' ')}`),
  );
  const yes = el('button', {}, "I'm in");
  yes.onclick = () => {
    negotiating();
    resolve({ approve: true });
  };
  const no = el('button', { class: 'ghost' }, 'Pass');
  no.onclick = () => resolve({ approve: false });
  screen(el('h1', {}, 'Proposed hangout'), card, yes, no);
}

function hangoutSummary(art: ProposedHangout): string {
  const p = art.plan;
  return [p.activity.specific || p.activity.class, p.place.name ?? p.place.type, `${p.time?.date ?? ''} ${p.time?.start ?? ''}`.trim()].filter(Boolean).join(' · ');
}

function renderTerminal(node: Node, t: DriverTerminal) {
  const back = el('button', {}, 'Back home');
  back.onclick = () => home(node);
  if (t.outcome === 'committed' && t.artifact) {
    const p = t.artifact.plan;
    screen(
      el('h1', {}, "You're on! 🎉"),
      el('div', { class: 'card' },
        el('h2', {}, p.activity.specific || p.activity.class),
        el('div', {}, `📍 ${p.place.name ?? p.place.type}`),
        el('div', {}, `🗓️ ${p.time?.date ?? ''} ${p.time?.start ?? ''}`),
        el('p', { class: 'muted' }, 'Contact details were exchanged after you both said yes.'),
      ),
      back,
    );
  } else {
    screen(el('h1', {}, 'No match this time'), el('p', { class: 'muted' }, "That's okay — your Personas couldn't find a fit right now."), back);
  }
}

// ---- boot -----------------------------------------------------------------

function boot() {
  const node = loadNode();
  if (tryPair(node)) return;
  if (loadProfile()) home(node);
  else onboarding(node);
}
boot();
