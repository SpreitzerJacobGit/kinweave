/**
 * Local social graph — your connections, tags, and groups. Lives on your device
 * (the PWA persists it to localStorage). Pure data functions so they're unit-
 * testable; no DOM, no network. A "connection" is someone you arranged a hangout
 * with; the name is what they chose to disclose (editable).
 */

export interface Connection {
  id: string; // counterpart signing-key fingerprint (stable, pseudonymous)
  name: string;
  tags: string[];
  firstMet: number;
  lastHangout?: string;
}

export interface Group {
  id: string;
  name: string;
  members: string[]; // connection ids
}

export interface SocialStore {
  connections: Record<string, Connection>;
  groups: Group[];
}

export const emptyStore = (): SocialStore => ({ connections: {}, groups: [] });

export function upsertConnection(s: SocialStore, c: { id: string; name?: string; when: number; hangout?: string }): SocialStore {
  const existing = s.connections[c.id];
  s.connections[c.id] = existing
    ? { ...existing, name: c.name?.trim() || existing.name, lastHangout: c.hangout ?? existing.lastHangout }
    : { id: c.id, name: c.name?.trim() || 'New connection', tags: [], firstMet: c.when, lastHangout: c.hangout };
  return s;
}

export function renameConnection(s: SocialStore, id: string, name: string): SocialStore {
  const c = s.connections[id];
  if (c && name.trim()) c.name = name.trim();
  return s;
}

export function addTag(s: SocialStore, id: string, tag: string): SocialStore {
  const t = tag.trim().toLowerCase();
  const c = s.connections[id];
  if (c && t && !c.tags.includes(t)) c.tags.push(t);
  return s;
}

export function removeTag(s: SocialStore, id: string, tag: string): SocialStore {
  const c = s.connections[id];
  if (c) c.tags = c.tags.filter((x) => x !== tag);
  return s;
}

export function deleteConnection(s: SocialStore, id: string): SocialStore {
  delete s.connections[id];
  for (const g of s.groups) g.members = g.members.filter((m) => m !== id);
  return s;
}

export function createGroup(s: SocialStore, name: string, id: string): SocialStore {
  if (name.trim()) s.groups.push({ id, name: name.trim(), members: [] });
  return s;
}

export function renameGroup(s: SocialStore, gid: string, name: string): SocialStore {
  const g = s.groups.find((x) => x.id === gid);
  if (g && name.trim()) g.name = name.trim();
  return s;
}

export function deleteGroup(s: SocialStore, gid: string): SocialStore {
  s.groups = s.groups.filter((g) => g.id !== gid);
  return s;
}

export function setInGroup(s: SocialStore, gid: string, connId: string, member: boolean): SocialStore {
  const g = s.groups.find((x) => x.id === gid);
  if (!g) return s;
  if (member) {
    if (!g.members.includes(connId)) g.members.push(connId);
  } else {
    g.members = g.members.filter((m) => m !== connId);
  }
  return s;
}

export function allTags(s: SocialStore): string[] {
  const set = new Set<string>();
  for (const c of Object.values(s.connections)) for (const t of c.tags) set.add(t);
  return [...set].sort();
}

export function connectionsList(s: SocialStore): Connection[] {
  return Object.values(s.connections).sort((a, b) => b.firstMet - a.firstMet);
}

export function groupsFor(s: SocialStore, connId: string): Group[] {
  return s.groups.filter((g) => g.members.includes(connId));
}
