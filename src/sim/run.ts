/**
 * CLI runner for the negotiation simulation.
 *
 *   npm run sim -- --pair compatible
 *   npm run sim -- --pair incompatible
 *   npm run sim -- --adversary scraper|injector|oracle
 *   npm run sim -- --p2p                 (peer-to-peer: discovery + sealed transport)
 *   npm run sim -- --calls               (intent board: structured intents -> match -> hangout)
 */

import { negotiate } from '../core/state-machine';
import { makePair, ava, ben, cleo } from './fixtures';
import { INJECTION_MESSAGES, craftInjection } from './adversary';
import { approveAll } from '../persona/owner';
import { Clock } from '../core/clock';
import { frameInbound } from '../core/inbound-envelope';
import { P2PNode } from '../core/node';
import { Relay } from '../core/transport';
import { PresenceBoard } from '../core/discovery';
import { Node } from '../portable/crypto';
import { StandingIntentBook } from '../portable/standing-intents';

function arg(name: string, fallback = ''): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

function line(s = '') {
  process.stdout.write(s + '\n');
}

function runPair(kind: 'compatible' | 'incompatible') {
  const clock = new Clock();
  const [a, b] =
    kind === 'compatible'
      ? makePair(ava, ben, approveAll, approveAll, {}, {}, clock)
      : makePair(ava, cleo, approveAll, approveAll, {}, {}, clock);

  line(`\n=== Negotiation: ${a.handle} <-> ${b.handle} (${kind}) ===`);
  const res = negotiate(a, b);

  line(`stages: ${res.stagesTraversed.join(' -> ')}`);
  line(`rounds: ${JSON.stringify(res.rounds)}`);
  if (res.outcome === 'committed' && res.artifact) {
    const art = res.artifact;
    line(`OUTCOME: COMMITTED  (${art.versionHash})`);
    line(`  plan: ${art.plan.activity.specific}`);
    line(`  place: ${art.plan.place.name} [public=${art.plan.place.isPublic}] @ ${art.plan.time.date} ${art.plan.time.start}`);
    line(`  confidence: ${art.compatibilityRationale.label} (${art.compatibilityRationale.overallConfidence})`);
    line(`  caveats: ${art.compatibilityRationale.honestCaveats.join(' | ')}`);
    line(`  disclosed by ${a.handle}: ${art.disclosureLedger.myRevealed.join(', ') || '(none)'}`);
    line(`  disclosed by ${b.handle}: ${art.disclosureLedger.theirRevealed.join(', ') || '(none)'}`);
    line(`  still private: ${art.disclosureLedger.stillPrivate.join(', ')}`);
  } else {
    line(`OUTCOME: ABANDONED  code=${res.code}`);
    line(`  public reason (to counterpart): "${res.publicReason}"`);
    line(`  true reason (owner-side only): "${res.trueReason}"`);
  }
  // Owner-side audit sample.
  const refusals = a.ledger.filter((e) => e.type === 'refusal');
  line(`  ${a.handle} gate refusals: ${refusals.length}`);
}

function runAdversary(kind: string) {
  const clock = new Clock();
  if (kind === 'scraper') {
    // A jailbroken counterpart that tries to over-disclose. Its own Gate refuses.
    const [a, b] = makePair(ava, ben, approveAll, approveAll, { overshare: true }, {}, clock);
    line('\n=== Adversary: scraper (jailbroken own-Persona tries to leak) ===');
    negotiate(a, b);
    const leaked = a
      .ledger
      .filter((e) => e.type === 'disclosure-out')
      .flatMap((e) => e.fields ?? []);
    const refused = a.ledger.filter((e) => e.type === 'refusal').flatMap((e) => e.fields ?? []);
    line(`  fields actually emitted: ${[...new Set(leaked)].join(', ')}`);
    line(`  fields REFUSED by the Gate: ${[...new Set(refused)].join(', ')}`);
    line(`  homeCoordinate emitted? ${leaked.includes('homeCoordinate')}`);
    line(`  interestVector emitted? ${leaked.includes('interestVector')}`);
    line(`  legalName emitted? ${leaked.includes('legalName')}`);
  } else if (kind === 'injector') {
    line('\n=== Adversary: injector (prompt-injection inbound) ===');
    for (const text of INJECTION_MESSAGES) {
      const framed = frameInbound(text);
      line(`  "${text.slice(0, 48)}..." -> flagged=${framed.injectionFlag} [${framed.matched.join(',')}]`);
    }
  } else if (kind === 'oracle') {
    line('\n=== Adversary: oracle (probe-cap enforcement) ===');
    const [a] = makePair(ava, ben, approveAll, approveAll, {}, {}, clock);
    const sig = { interestSignal: [0.9, 0.8, 0.2, 0.7, 0.1], hobbyTags: ['coffee'] };
    for (let i = 1; i <= 6; i++) {
      const r = a.assessMatch(sig);
      line(`  probe ${i}: band=${r.band ?? 'BLOCKED'} capped=${r.capped}`);
    }
  } else {
    line(`unknown adversary: ${kind}`);
  }
}

function runP2P() {
  line('\n=== Peer-to-peer: decentralized discovery + sealed transport (no server, no broker) ===');
  const board = new PresenceBoard(); // models mDNS / local broadcast / DHT — untrusted medium
  const relay = new Relay(); // untrusted infrastructure — routes, cannot read
  const alice = new P2PNode();
  const bob = new P2PNode();

  // 1. Each node publishes a SIGNED, T0-only presence beacon.
  board.announce(alice.beacon('northside-climbers', ['climbing', 'board-games'], 'northside'));
  board.announce(bob.beacon('northside-climbers', ['board-games', 'coffee'], 'northside'));
  line(`  alice ${alice.id}  bob ${bob.id}`);

  // 2. Alice discovers Bob locally (and re-verifies his beacon signature).
  const peers = board.discover('northside-climbers', 'board-games').filter((b) => b.pubKey !== alice.identity.pubKey);
  line(`  alice discovered ${peers.length} peer(s) via signed local beacons`);
  const peer = peers[0]!;

  // 3. Alice seals a first message to Bob and sends it over the untrusted relay.
  const secret = 'HELLO bob — want to co-plan a board-games meetup?';
  const env = alice.seal({ pubKey: peer.pubKey, encPubKey: peer.encPubKey }, secret);
  const res = relay.send(env);
  line(`  relay accepted (signature valid): ${res.accepted}`);

  // 4. What can the relay see? Only ciphertext + routing metadata.
  const relaySees = JSON.stringify(relay.observable());
  line(`  relay can read the message text? ${relaySees.includes('board-games meetup')}`);

  // 5. Only Bob can open it.
  const inbox = relay.receiveFor(bob.id);
  line(`  bob opened: "${bob.open(inbox[0]!)}"`);

  // 6. A forged/tampered envelope is rejected by the relay.
  const forged = { ...env, box: { ...env.box, ct: Buffer.from('evil').toString('base64') } };
  line(`  tampered envelope accepted? ${relay.send(forged).accepted}`);
}

function runCalls() {
  line('\n=== Intent board: structured intents -> local match -> gated hangout (spec/10) ===');
  const NOW = 1_000_000;
  const HOUR = 3_600_000;
  const CID = ava.community; // 'northside-climbers'
  const benNode = new Node();
  const cleoNode = new Node();

  // Ben and Cleo publish coarse OpenCalls to the community intent board.
  const bensCall = benNode.openCall({ community: CID, activityClass: 'games', timeBand: 'weekend_day', geoCell: 'northside', groupSize: 'one_on_one', expiry: NOW + 24 * HOUR, nonce: 'ben-1' });
  const cleosCall = cleoNode.openCall({ community: CID, activityClass: 'nightlife', timeBand: 'weekday_eve', geoCell: 'downtown', groupSize: 'small', expiry: NOW + 24 * HOUR, nonce: 'cleo-1' });
  const board = [bensCall, cleosCall];
  line(`  board holds ${board.length} open call(s): ${board.map((c) => `${c.activityClass}/${c.timeBand}/${c.geoCell}`).join('  ')}`);

  // The wire atoms carry nothing from Zone O.
  const wire = JSON.stringify(board);
  line(`  board leaks a coordinate / name / contact / raw vector? ${/homeCoordinate|legalName|signal:@|interestVector/.test(wire)}`);

  // Ava's standing intent passively matches the board (owner-side digest, anti-spiral bounded).
  const book = new StandingIntentBook([
    { id: 'si-games', activityClasses: ['games'], timeBands: ['weekend_day', 'weekend_eve'], geoCells: ['northside'], groupSize: 'any', until: NOW + 30 * 24 * HOUR },
  ]);
  const digest = book.digest(board, ava, { now: NOW });
  line(`  ava's digest surfaced ${digest.length} candidate(s):`);
  for (const c of digest) {
    const who = c.call.pubKey === benNode.identity.pubKey ? 'ben' : c.call.pubKey === cleoNode.identity.pubKey ? 'cleo' : '?';
    line(`    - ${who}: band=${c.match.band}  (${c.match.reasons.join('; ')})`);
  }
  line(`  cleo filtered out (no shared activity/schedule/geo)? ${!digest.some((c) => c.call.pubKey === cleoNode.identity.pubKey)}`);

  // The surfaced candidate → the SAME gated pairwise negotiation as `--pair compatible`.
  const [a, b] = makePair(ava, ben, approveAll, approveAll, {}, {}, new Clock());
  const res = negotiate(a, b);
  if (res.outcome === 'committed' && res.artifact) {
    const art = res.artifact;
    line(`  ava responded to ben's call -> COMMITTED (${art.versionHash})`);
    line(`    plan: ${art.plan.activity.specific} @ ${art.plan.place.name}, ${art.plan.time.date} ${art.plan.time.start}`);
    line(`    published on the board (coarse): activityClass, timeBand, geoCell, groupSize`);
    line(`    still private (Zone O): ${art.disclosureLedger.stillPrivate.join(', ')}`);
  } else {
    line(`  negotiation abandoned: code=${res.code}`);
  }
}

const adv = arg('adversary');
if (process.argv.includes('--calls')) {
  runCalls();
} else if (process.argv.includes('--p2p')) {
  runP2P();
} else if (adv) {
  runAdversary(adv);
} else {
  const pair = arg('pair', 'compatible') as 'compatible' | 'incompatible';
  runPair(pair);
}
