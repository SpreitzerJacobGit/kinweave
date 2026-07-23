/**
 * Kinweave PWA. Keys + profile (Zone O) live in this browser (localStorage);
 * the Persona/Gate/Ledger/driver run here; the server is only an untrusted relay
 * + a Claude proxy. Screens: onboarding -> home -> connect (QR) -> negotiate
 * (consent taps) -> hangout.
 */

import qrcode from 'qrcode-generator';
import { Node, verifySig, beaconBody, fingerprint, type PresenceBeacon } from '../src/portable/crypto';
import { connectRelay, type RelayConn } from '../src/portable/relay-connect';
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
      const r = await fetch('/api/onboard', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: history }) });
      if (r.status === 501) return bubble('ai', 'Claude onboarding is off (no API key on the server). Tap "Build my Persona" to use the quick form instead.');
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
      const r = await fetch('/api/extract', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: history }) });
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

  screen(el('h1', {}, 'Build your Persona'), log, inputRow, buildBtn);
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
      const beacon = decodeBeacon(pending);
      if (beacon) return startConnect(node, loadProfile()!, beacon);
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
  const reset = el('button', { class: 'ghost' }, 'Start over');
  reset.onclick = () => {
    LS.removeItem('kw_profile');
    onboarding(node);
  };

  screen(
    el('h1', {}, `You're set, ${p.firstName}`),
    el('div', { class: 'card' }, el('div', { class: 'muted' }, 'Your interests'), tags),
    el('p', { class: 'muted' }, 'Meet someone by scanning their code in person, or send them an invite link.'),
    connect,
    reset,
  );
}

// ---- connect (show QR; wait as responder) ---------------------------------

async function connectScreen(node: Node, profile: PrivateProfile) {
  const beacon = node.beacon('local', profile.hobbyTags, profile.geoCell);
  const payload = btoa(JSON.stringify({ v: 1, beacon, rt: rid() }));
  const link = `${location.origin}/#pair=${payload}`;

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

function decodeBeacon(payload: string): PresenceBeacon | null {
  try {
    const b = (JSON.parse(atob(payload)) as { beacon: PresenceBeacon }).beacon;
    return verifySig(b.pubKey, beaconBody(b), b.sig) ? b : null;
  } catch {
    return null;
  }
}
function startConnect(node: Node, profile: PrivateProfile, beacon: PresenceBeacon) {
  runSession(node, profile, {
    role: 'initiator',
    peer: { pubKey: beacon.pubKey, encPubKey: beacon.encPubKey },
    counterpartFp: fingerprint(beacon.pubKey),
  });
}

function tryPair(node: Node): boolean {
  const m = location.hash.match(/#pair=(.+)/);
  if (!m) return false;
  const payload = m[1]!;
  history.replaceState(null, '', location.pathname); // don't re-trigger on refresh
  const beacon = decodeBeacon(payload);
  if (!beacon) {
    screen(el('h1', {}, 'Invalid link'), el('p', { class: 'muted' }, "That connect link couldn't be verified. Ask them to send a fresh one."));
    return true;
  }
  const p = loadProfile();
  if (!p) {
    // Brand-new person: build a Persona first, then auto-connect to the inviter.
    sessionStorage.setItem('kw_pair', payload);
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

  const build = (peer: { pubKey: string; encPubKey: string }, cpFp: string) => {
    const persona = new Persona(profile, cpFp, approveAll, new Clock(), {});
    const driver = new NegotiationDriver(persona, cpFp, opts.role);
    return new Session(node, driver, peer, {
      send: (env) => conn.send(env),
      onGateRequest: (req) => renderGate(node, req, (d) => session!.resolveGate(d)),
      onTerminal: (t) => renderTerminal(node, t),
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
