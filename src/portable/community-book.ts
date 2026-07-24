/**
 * The device's set of joined communities + which one is active (spec/10 §2).
 *
 * A community is self-certifying (id === fingerprint(pubKey)); this book just
 * remembers the descriptors this device has minted or joined and which one the
 * boards (presence + intent) currently key on. The community SECRET (mint key)
 * is kept only for communities this device founded, so it can rotate them; it is
 * never needed to participate. Pure + serializable (toJSON/fromJSON) so the PWA
 * (localStorage) and the MCP agent (state.json) share one implementation.
 *
 * `activeId()` is null until the owner creates/joins + selects one; callers fall
 * back to the shared 'local' community (the in-person default) when it is null.
 */

import { mintCommunity, verifyCommunity, type CommunityDescriptorV1, type CommunitySecret, type MintCommunityInput } from './community';

export interface JoinedCommunity {
  descriptor: CommunityDescriptorV1;
  secret?: CommunitySecret; // present iff this device minted it (can rotate)
}

export interface CommunityBookState {
  communities: JoinedCommunity[];
  activeId: string | null;
}

export type JoinResult = { ok: true; community: JoinedCommunity } | { ok: false; reason: string };

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

export class CommunityBook {
  private items: JoinedCommunity[];
  private _activeId: string | null;

  constructor(state: Partial<CommunityBookState> = {}) {
    this.items = (state.communities ?? []).map(clone);
    this._activeId = state.activeId ?? null;
  }

  list(): JoinedCommunity[] {
    return this.items.map(clone);
  }

  get(id: string): JoinedCommunity | undefined {
    const found = this.items.find((c) => c.descriptor.community.id === id);
    return found ? clone(found) : undefined;
  }

  activeId(): string | null {
    return this._activeId;
  }

  active(): JoinedCommunity | undefined {
    return this._activeId ? this.get(this._activeId) : undefined;
  }

  /** Add (or replace by id) a descriptor. Becomes active if it is the first one. */
  add(descriptor: CommunityDescriptorV1, secret?: CommunitySecret): JoinedCommunity {
    const id = descriptor.community.id;
    this.items = this.items.filter((c) => c.descriptor.community.id !== id);
    const entry: JoinedCommunity = secret ? { descriptor: clone(descriptor), secret: clone(secret) } : { descriptor: clone(descriptor) };
    this.items.push(entry);
    if (this._activeId === null) this._activeId = id;
    return clone(entry);
  }

  remove(id: string): void {
    this.items = this.items.filter((c) => c.descriptor.community.id !== id);
    if (this._activeId === id) this._activeId = this.items[0]?.descriptor.community.id ?? null;
  }

  setActive(id: string | null): boolean {
    if (id === null) {
      this._activeId = null;
      return true;
    }
    if (!this.items.some((c) => c.descriptor.community.id === id)) return false;
    this._activeId = id;
    return true;
  }

  /** Create a brand-new community (mint keypair + signed descriptor), store it, make it active. */
  create(input: MintCommunityInput): JoinedCommunity {
    const { descriptor, secret } = mintCommunity(input);
    const entry = this.add(descriptor, secret);
    this._activeId = descriptor.community.id;
    return entry;
  }

  /** Join a scanned/pasted descriptor after verifying it binds id↔key↔contents and is unexpired. */
  join(descriptor: CommunityDescriptorV1, now?: number): JoinResult {
    if (!verifyCommunity(descriptor, now)) return { ok: false, reason: 'invalid-or-expired-descriptor' };
    const existing = this.get(descriptor.community.id);
    // Keep our own mint secret if we already had it (a re-scan of our own community).
    const entry = this.add(descriptor, existing?.secret);
    return { ok: true, community: entry };
  }

  toJSON(): CommunityBookState {
    return { communities: this.list(), activeId: this._activeId };
  }

  static fromJSON(state: Partial<CommunityBookState> = {}): CommunityBook {
    return new CommunityBook(state);
  }
}
