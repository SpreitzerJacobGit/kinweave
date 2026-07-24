import { describe, it, expect, afterEach } from 'vitest';
import { startServer, type RunningServer } from '../server/index';
import { Node, fingerprint } from '../src/portable/crypto';
import { KinweaveAgent } from '../src/portable/agent';
import { ava, ben } from '../src/sim/fixtures';

/**
 * Proves the intent-board MCP tool path end-to-end WITHOUT Claude: Ben posts an
 * open call, Ava lists the board (and it scores as a match), Ava responds, and
 * the same gated negotiation drives both to a committed hangout over the real
 * relay — exactly the sequence the kinweave_post/list/respond tools drive.
 * ava/ben share the 'northside-climbers' community, so they see one board.
 */
describe('MCP intent tools — post an open call, discover it, respond, commit', () => {
  let server: RunningServer | undefined;
  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it('postOpenCall -> listCalls (matched) -> respondToCall -> committed', async () => {
    server = await startServer(0);
    const url = `ws://127.0.0.1:${server.port}/relay`;

    const savedA: { id: string; name: string; hangout?: string }[] = [];
    const savedB: { id: string; name: string; hangout?: string }[] = [];
    const nodeB = new Node();
    const A = new KinweaveAgent(new Node(), ava, url, (i) => savedA.push(i)); // discovers & responds
    const B = new KinweaveAgent(nodeB, ben, url, (i) => savedB.push(i)); // publishes the call

    // Ben posts a coarse open call.
    const call = await B.postOpenCall({ activityClass: 'games', timeBand: 'weekend_day', geoCell: 'northside', groupSize: 'one_on_one' });
    expect(call.pubKey).toBe(nodeB.identity.pubKey);
    // The wire atom carries nothing from Zone O.
    for (const banned of ['legalName', 'homeCoordinate', 'interestVector', 'signal:@']) {
      expect(JSON.stringify(call)).not.toContain(banned);
    }

    // Ava lists the board and sees Ben's call, scored as a match.
    const listing = await A.listCalls();
    const found = listing.find((x) => x.call.pubKey === nodeB.identity.pubKey);
    expect(found).toBeTruthy();
    expect(found!.match).not.toBeNull();
    expect(found!.match!.band).toBe('high');

    // Ava responds (by the id the list tool surfaces) → gated negotiation begins.
    await A.respondToCall(fingerprint(nodeB.identity.pubKey));

    const drive = async (ag: KinweaveAgent) => {
      let guard = 0;
      while (!ag.status().outcome && guard++ < 40) {
        await ag.waitForNext(8000);
        if (ag.status().pendingApproval) ag.approve();
      }
    };
    await Promise.all([drive(A), drive(B)]);

    expect(A.status().outcome).toBe('committed');
    expect(B.status().outcome).toBe('committed');
    expect(A.status().hangout).toBeTruthy();

    // Both saved the other as a connection with the disclosed name.
    expect(savedA[0]?.name).toBe('Ben');
    expect(savedB[0]?.name).toBe('Ava');

    A.close();
    B.close();
  }, 30000);
});
