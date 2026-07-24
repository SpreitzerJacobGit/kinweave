import { describe, it, expect, afterEach } from 'vitest';
import { startServer, type RunningServer } from '../server/index';
import { Node, fingerprint } from '../src/portable/crypto';
import { connectRelay } from '../src/portable/relay-connect';
import { Session } from '../src/portable/session';
import { NegotiationDriver } from '../src/core/negotiation-driver';
import { CommunityMembership } from '../src/portable/community-connect';
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

describe('community join over the public board (spec/10)', () => {
  let server: RunningServer | undefined;
  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it('N nodes join one community, discover each other, and the board holds only T0', async () => {
    server = await startServer(0);
    const url = `ws://127.0.0.1:${server.port}/relay`;
    const { descriptor } = mintCommunity({ name: 'Northside Climbers', relays: [url] });
    const cid = descriptor.community.id;

    const nodeA = new Node();
    const nodeB = new Node();
    const nodeC = new Node();
    const mA = new CommunityMembership(nodeA, url, cid);
    const mB = new CommunityMembership(nodeB, url, cid);
    const mC = new CommunityMembership(nodeC, url, cid);
    await mA.join({ hobbyTags: ava.hobbyTags, geoCell: ava.geoCell });
    await mB.join({ hobbyTags: ben.hobbyTags, geoCell: ben.geoCell });
    await mC.join({ hobbyTags: ['cycling'], geoCell: 'northside' });

    await waitFor(() => mA.members().length === 2 && mB.members().length === 2 && mC.members().length === 2);

    // A discovered B via the board (not via a shared code).
    const bMember = mA.members().find((m) => m.id === fingerprint(nodeB.identity.pubKey));
    expect(bMember).toBeTruthy();

    // Privacy: the board only ever holds T0 presence beacon fields — no contact / name / prefs.
    expect(Object.keys(bMember!.beacon).sort()).toEqual(['community', 'encPubKey', 'geoCell', 'hobbyTags', 'pubKey', 'sig']);
    const asText = JSON.stringify([mA.members(), mB.members(), mC.members()]);
    expect(asText).not.toMatch(/signal:@/); // no contact
    expect(asText).not.toMatch(/Ava|Ben/); // no first / legal name
    expect(asText).not.toContain(ava.contact);
    expect(asText).not.toContain('interestVector');

    mA.close();
    mB.close();
    mC.close();

    // Discovered beacon → full gated pairwise negotiation to a committed hangout.
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
    // A seeds the peer from the DISCOVERED beacon, not from prior direct knowledge.
    sessA = new Session(nodeA, driverA, { pubKey: bMember!.beacon.pubKey, encPubKey: bMember!.beacon.encPubKey }, {
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
