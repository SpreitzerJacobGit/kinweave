import { describe, it, expect, afterEach } from 'vitest';
import { startServer, type RunningServer } from '../server/index';
import { Node, fingerprint } from '../src/portable/crypto';
import { connectRelay } from '../src/portable/relay-connect';
import { Session } from '../src/portable/session';
import { NegotiationDriver } from '../src/core/negotiation-driver';
import { IntentBoardMembership } from '../src/portable/intent-connect';
import { matchCall } from '../src/core/call-match';
import { mintCommunity } from '../src/portable/community';
import { makePair, ava, ben } from '../src/sim/fixtures';
import { approveAll } from '../src/persona/owner';
import { negotiate } from '../src/core/state-machine';
import type { DriverTerminal } from '../src/types/negotiation';

async function waitFor(cond: () => boolean, ms = 5000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timeout waiting for condition');
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('intent board → gated negotiation (spec/10)', () => {
  let server: RunningServer | undefined;
  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it('a discovered OpenCall matches locally and drives a full gated hangout, board stays coarse', async () => {
    server = await startServer(0);
    const url = `ws://127.0.0.1:${server.port}/relay`;
    const { descriptor } = mintCommunity({ name: 'Northside Climbers', relays: [url] });
    const cid = descriptor.community.id;

    const nodeA = new Node(); // Ava — will discover & respond
    const nodeB = new Node(); // Ben — publishes an OpenCall

    // Ben publishes a coarse intent; Ava joins and mirrors the board.
    const bensCall = nodeB.openCall({
      community: cid,
      activityClass: 'games',
      timeBand: 'weekend_day',
      geoCell: 'northside',
      groupSize: 'one_on_one',
      expiry: Date.now() + 60 * 60 * 1000,
      nonce: 'ben-1',
    });
    const mB = new IntentBoardMembership(nodeB, url, cid);
    const mA = new IntentBoardMembership(nodeA, url, cid);
    await mB.join({ call: bensCall });
    await mA.join({});

    await waitFor(() => mA.calls().length === 1);

    // Ava discovered Ben's intent via the board (not via a shared code) and matched it locally.
    const discovered = mA.calls()[0]!;
    expect(discovered.pubKey).toBe(nodeB.identity.pubKey);
    const match = matchCall(discovered, ava);
    expect(match).not.toBeNull();
    expect(match!.scheduleFit && match!.geoFit && match!.groupFit).toBe(true);

    // Privacy: the intent board only ever holds coarse OpenCall fields — no contact / name / prefs.
    expect(Object.keys(discovered).sort()).toEqual(
      ['activityClass', 'community', 'encPubKey', 'expiry', 'geoCell', 'groupSize', 'nonce', 'pubKey', 'sig', 'timeBand'].sort(),
    );
    const asText = JSON.stringify(mA.calls());
    expect(asText).not.toMatch(/signal:@/); // no contact
    expect(asText).not.toMatch(/Ava|Ben/); // no first / legal name
    expect(asText).not.toContain('interestVector');
    expect(asText).not.toContain('homeCoordinate');

    mA.close();
    mB.close();

    // Matched call → full gated pairwise negotiation to a committed hangout.
    // Ava initiates (seeding the peer from the DISCOVERED call), Ben responds —
    // same role assignment as the reference sim, so the artifact hashes match.
    const [pa, pb] = makePair(ava, ben, approveAll, approveAll);
    const driverA = new NegotiationDriver(pa, pb.ownerId, 'initiator');
    const driverB = new NegotiationDriver(pb, pa.ownerId, 'responder');
    let doneA!: (t: DriverTerminal) => void;
    let doneB!: (t: DriverTerminal) => void;
    const termA = new Promise<DriverTerminal>((r) => (doneA = r));
    const termB = new Promise<DriverTerminal>((r) => (doneB = r));

    let sessA: Session;
    let sessB: Session;
    const connA = await connectRelay(url, nodeA.identity, (env) => sessA.onEnvelope(env));
    const connB = await connectRelay(url, nodeB.identity, (env) => sessB.onEnvelope(env));
    sessA = new Session(nodeA, driverA, { pubKey: discovered.pubKey, encPubKey: discovered.encPubKey }, {
      send: connA.send,
      onGateRequest: (req) => sessA.resolveGate(pa.decideGate(req)),
      onTerminal: doneA,
    });
    sessB = new Session(nodeB, driverB, null, {
      send: connB.send,
      onGateRequest: (req) => sessB.resolveGate(pb.decideGate(req)),
      onTerminal: doneB,
    });
    sessB.start();
    sessA.start();

    const [ra, rb] = makePair(ava, ben, approveAll, approveAll);
    const ref = negotiate(ra, rb);
    const [ta, tb] = await Promise.all([termA, termB]);
    expect(ta.outcome).toBe('committed');
    expect(tb.outcome).toBe('committed');
    expect(ta.artifact?.versionHash).toBe(ref.artifact?.versionHash);
    expect(tb.artifact?.versionHash).toBe(ref.artifact?.versionHash);

    connA.close();
    connB.close();
  }, 20000);
});
