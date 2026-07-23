/**
 * CLI runner for the negotiation simulation.
 *
 *   npm run sim -- --pair compatible
 *   npm run sim -- --pair incompatible
 *   npm run sim -- --adversary scraper|injector|oracle
 */

import { negotiate } from '../core/state-machine';
import { makePair, ava, ben, cleo } from './fixtures';
import { INJECTION_MESSAGES, craftInjection } from './adversary';
import { approveAll } from '../persona/owner';
import { Clock } from '../core/clock';
import { frameInbound } from '../core/inbound-envelope';

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

const adv = arg('adversary');
if (adv) {
  runAdversary(adv);
} else {
  const pair = arg('pair', 'compatible') as 'compatible' | 'incompatible';
  runPair(pair);
}
