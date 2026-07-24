import { describe, it, expect, afterEach } from 'vitest';
import { startServer, type RunningServer } from '../server/index';
import { Node, fingerprint } from '../src/portable/crypto';
import { KinweaveAgent } from '../src/portable/agent';
import { mintCommunity } from '../src/portable/community';
import { ava, ben } from '../src/sim/fixtures';

/**
 * The community-scoped intent flow the kinweave_create/join/use tools drive:
 * two agents point at the same created community, post + discover + respond to a
 * committed hangout — and a third agent on a DIFFERENT community sees nothing
 * (boards are keyed by community id).
 */
describe('MCP community tools — scoped boards + isolation', () => {
  let server: RunningServer | undefined;
  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it('setCommunity scopes the intent board; a different community is isolated', async () => {
    server = await startServer(0);
    const url = `ws://127.0.0.1:${server.port}/relay`;

    // A creates a community (as kinweave_create_community would); B joins it.
    const community = mintCommunity({ name: 'Board Gamers', relays: [url] }).descriptor;
    const other = mintCommunity({ name: 'Cyclists', relays: [url] }).descriptor;

    const savedA: { id: string; name: string }[] = [];
    const savedB: { id: string; name: string }[] = [];
    const nodeA = new Node();
    const A = new KinweaveAgent(nodeA, ava, url, (i) => savedA.push(i)); // posts
    const B = new KinweaveAgent(new Node(), ben, url, (i) => savedB.push(i)); // discovers & responds
    const C = new KinweaveAgent(new Node(), ben, url); // lurker on another community

    A.setCommunity(community.community.id);
    B.setCommunity(community.community.id);
    C.setCommunity(other.community.id);
    expect(A.community()).toBe(community.community.id);

    await A.postOpenCall({ activityClass: 'games', timeBand: 'weekend_day', geoCell: 'northside', groupSize: 'one_on_one' });

    // B (same community) sees the call; C (other community) does not.
    const listB = await B.listCalls();
    expect(listB.find((x) => x.call.pubKey === nodeA.identity.pubKey)).toBeTruthy();
    const listC = await C.listCalls();
    expect(listC.find((x) => x.call.pubKey === nodeA.identity.pubKey)).toBeFalsy();

    // B responds → the same gated negotiation → committed for both.
    await B.respondToCall(fingerprint(nodeA.identity.pubKey));
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
    expect(savedA[0]?.name).toBe('Ben');
    expect(savedB[0]?.name).toBe('Ava');

    A.close();
    B.close();
    C.close();
  }, 30000);
});
