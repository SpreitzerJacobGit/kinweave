import { describe, it, expect } from 'vitest';
import { Identity } from '../src/portable/crypto';
import { mintVouch, mintVouchRevoke } from '../src/portable/vouch';
import { buildTrustGraph } from '../src/portable/trust-graph';

const NOW = 1_700_000_000_000;
const C = 'kw_community';

describe('trust-graph (seeded flow)', () => {
  it('a direct vouch from a root confers trust; the joiner counts one trusted voucher', () => {
    const root = Identity.generate();
    const j = Identity.generate();
    const g = buildTrustGraph([mintVouch(root, j.id, C, NOW)], { roots: [root.id], now: NOW });
    expect(g.trust(j.id)).toBeGreaterThan(0);
    expect(g.trustedVouchers(j.id)).toEqual([root.id]);
  });

  it('a Sybil ring with no path from a root scores zero', () => {
    const root = Identity.generate();
    const s1 = Identity.generate();
    const s2 = Identity.generate();
    const j = Identity.generate();
    // s1<->s2 cross-vouch and both vouch j, but none is reachable from root.
    const atts = [
      mintVouch(s1, s2.id, C, NOW),
      mintVouch(s2, s1.id, C, NOW),
      mintVouch(s1, j.id, C, NOW),
      mintVouch(s2, j.id, C, NOW),
    ];
    const g = buildTrustGraph(atts, { roots: [root.id], now: NOW });
    expect(g.trust(j.id)).toBe(0);
    expect(g.trustedVouchers(j.id)).toEqual([]); // vouchers exist but are themselves untrusted
  });

  it('trust flows transitively root → member → joiner', () => {
    const root = Identity.generate();
    const m = Identity.generate();
    const j = Identity.generate();
    const g = buildTrustGraph([mintVouch(root, m.id, C, NOW), mintVouch(m, j.id, C, NOW)], { roots: [root.id], now: NOW });
    expect(g.trust(m.id)).toBeGreaterThan(0);
    expect(g.trust(j.id)).toBeGreaterThan(0);
    expect(g.trustedVouchers(j.id)).toEqual([m.id]);
  });

  it('revocation prunes the edge', () => {
    const root = Identity.generate();
    const j = Identity.generate();
    const atts = [mintVouch(root, j.id, C, NOW), mintVouchRevoke(root, j.id, C, NOW + 1)];
    const g = buildTrustGraph(atts, { roots: [root.id], now: NOW + 2 });
    expect(g.trust(j.id)).toBe(0);
    expect(g.trustedVouchers(j.id)).toEqual([]);
  });

  it('personal distrust vetoes a member and prunes their downstream', () => {
    const root = Identity.generate();
    const m = Identity.generate();
    const j = Identity.generate();
    const atts = [mintVouch(root, m.id, C, NOW), mintVouch(m, j.id, C, NOW)];
    const g = buildTrustGraph(atts, { roots: [root.id], now: NOW, distrust: [m.id] });
    expect(g.trust(m.id)).toBe(0);
    expect(g.trust(j.id)).toBe(0); // m pruned, so j loses its only path
  });

  it('personal roots add a local trust seed (hybrid rooting)', () => {
    const p = Identity.generate(); // someone I personally trust, not a community root
    const j = Identity.generate();
    const g = buildTrustGraph([mintVouch(p, j.id, C, NOW)], { roots: [], personalRoots: [p.id], now: NOW });
    expect(g.trust(j.id)).toBeGreaterThan(0);
    expect(g.trustedVouchers(j.id)).toEqual([p.id]);
  });

  it('counts multiple distinct trusted vouchers', () => {
    const r1 = Identity.generate();
    const r2 = Identity.generate();
    const j = Identity.generate();
    const g = buildTrustGraph([mintVouch(r1, j.id, C, NOW), mintVouch(r2, j.id, C, NOW)], { roots: [r1.id, r2.id], now: NOW });
    expect(g.trustedVouchers(j.id).sort()).toEqual([r1.id, r2.id].sort());
  });
});
