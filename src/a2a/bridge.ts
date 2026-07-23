/**
 * A2A bridge — makes a Kinweave agent speak Agent2Agent. An incoming A2A
 * `message/send` carries Kinweave protocol messages (in a DataPart); the bridge
 * feeds them to the tested NegotiationDriver and returns a Task, completing with
 * the ProposedHangout as an Artifact. Kinweave's disclosure ladder + consent
 * gates run INSIDE the task (owner gates auto-approved in this spike). Transport-
 * agnostic: `handleRpc` takes/returns JSON-RPC; the HTTP server is separate.
 */

import { Persona } from '../persona/persona';
import { NegotiationDriver } from '../core/negotiation-driver';
import { Clock } from '../core/clock';
import { approveAll } from '../persona/owner';
import type { PrivateProfile } from '../types/profile';
import type { Message as KwMessage } from '../types/envelope';
import type { DriverTerminal } from '../types/negotiation';
import type { ProposedHangout } from '../types/artifact';
import type { Node } from '../portable/crypto';
import { buildAgentCard, KINWEAVE_P2P_EXT } from './agent-card';
import type { A2AMessage, AgentCard, Artifact, JsonRpcRequest, JsonRpcResponse, Task, TaskState } from './types';

let seq = 0;
const mid = () => `m-${++seq}-${Math.random().toString(16).slice(2, 8)}`;

/** Advance a driver, auto-resolving owner gates via the persona policy (spike). */
function step(driver: NegotiationDriver, persona: Persona, event: Parameters<NegotiationDriver['run']>[0]): { outbound: KwMessage[]; terminal?: DriverTerminal } {
  let out = driver.run(event);
  const outbound = [...out.outbound];
  let g = 0;
  while (out.gateRequest && !out.terminal && g++ < 60) {
    out = driver.run({ k: 'gateResult', decision: persona.decideGate(out.gateRequest) });
    outbound.push(...out.outbound);
  }
  return { outbound, terminal: out.terminal };
}

function kwPart(from: string, messages: KwMessage[]) {
  return { kind: 'data' as const, data: { kinweave: '1', from, messages } };
}
function a2aMessage(role: 'user' | 'agent', from: string, contextId: string, messages: KwMessage[]): A2AMessage {
  return { role, kind: 'message', messageId: mid(), contextId, parts: [kwPart(from, messages)] };
}
function readKw(msg: A2AMessage | undefined): { from?: string; messages: KwMessage[] } {
  const dp = msg?.parts.find((p) => p.kind === 'data') as { data: { from?: string; messages?: KwMessage[] } } | undefined;
  return { from: dp?.data.from, messages: dp?.data.messages ?? [] };
}
function artifactOf(hangout: ProposedHangout): Artifact {
  return { artifactId: 'proposed-hangout', name: 'Proposed hangout', parts: [{ kind: 'data', data: { hangout } }] };
}

interface Ctx {
  driver: NegotiationDriver;
  persona: Persona;
  terminal?: DriverTerminal;
}

export class A2ABridge {
  /** JSON-RPC endpoint URL — set once the HTTP server is listening. */
  url = '';
  private contexts = new Map<string, Ctx>();

  constructor(
    private readonly node: Node,
    private readonly profile: PrivateProfile,
    private readonly name: string,
  ) {}

  agentCard(): AgentCard {
    return buildAgentCard({
      name: this.name,
      url: this.url,
      ownerId: this.profile.ownerId,
      beacon: this.node.beacon('local', this.profile.hobbyTags, this.profile.geoCell),
    });
  }

  handleRpc(req: JsonRpcRequest): JsonRpcResponse {
    try {
      if (req.method === 'message/send') return { jsonrpc: '2.0', id: req.id, result: this.onMessageSend(req.params as { message: A2AMessage }) };
      if (req.method === 'tasks/get') {
        const p = req.params as { id: string };
        return { jsonrpc: '2.0', id: req.id, result: this.taskOf(p.id, this.contexts.get(p.id)) };
      }
      return { jsonrpc: '2.0', id: req.id, error: { code: -32601, message: `method not found: ${req.method}` } };
    } catch (e) {
      return { jsonrpc: '2.0', id: req.id, error: { code: -32603, message: String((e as Error).message) } };
    }
  }

  /** As the RESPONDER: process inbound Kinweave messages, return a Task. */
  private onMessageSend(params: { message: A2AMessage }): Task {
    const ctxId = params.message.contextId ?? params.message.messageId;
    const { from, messages } = readKw(params.message);
    let ctx = this.contexts.get(ctxId);
    if (!ctx) {
      const counterpart = from ?? 'peer';
      const persona = new Persona(this.profile, counterpart, approveAll, new Clock(), {});
      ctx = { driver: new NegotiationDriver(persona, counterpart, 'responder'), persona };
      this.contexts.set(ctxId, ctx);
    }
    const outbound: KwMessage[] = [];
    for (const m of messages) {
      const r = step(ctx.driver, ctx.persona, { k: 'inbound', msg: m });
      outbound.push(...r.outbound);
      if (r.terminal) ctx.terminal = r.terminal;
    }
    return this.taskOf(ctxId, ctx, outbound);
  }

  private taskOf(ctxId: string, ctx: Ctx | undefined, outbound: KwMessage[] = []): Task {
    const state: TaskState = ctx?.terminal ? (ctx.terminal.outcome === 'committed' ? 'completed' : 'failed') : 'working';
    const task: Task = {
      id: ctxId,
      contextId: ctxId,
      kind: 'task',
      status: { state, timestamp: new Date().toISOString(), message: a2aMessage('agent', this.profile.ownerId, ctxId, outbound) },
    };
    if (ctx?.terminal?.outcome === 'committed' && ctx.terminal.artifact) task.artifacts = [artifactOf(ctx.terminal.artifact)];
    return task;
  }
}

// ---------------------------------------------------------------------------

async function postRpc(url: string, method: string, params: unknown): Promise<JsonRpcResponse> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: mid(), method, params } satisfies JsonRpcRequest),
  });
  return (await res.json()) as JsonRpcResponse;
}

/**
 * As the INITIATOR (A2A client): discover a peer via its Agent Card and negotiate
 * a hangout over A2A `message/send`. Returns the committed ProposedHangout or null.
 */
export async function negotiateOverA2A(node: Node, profile: PrivateProfile, agentCardUrl: string): Promise<ProposedHangout | null> {
  const card = (await (await fetch(agentCardUrl)).json()) as AgentCard;
  const ext = card.capabilities.extensions?.find((e) => e.uri.startsWith(KINWEAVE_P2P_EXT));
  const counterpart = (ext?.params?.ownerId as string) ?? 'peer';
  const rpcUrl = card.url;

  const persona = new Persona(profile, counterpart, approveAll, new Clock(), {});
  const driver = new NegotiationDriver(persona, counterpart, 'initiator');
  const contextId = `ctx-${Math.random().toString(16).slice(2)}`;

  let { outbound, terminal } = step(driver, persona, { k: 'start' });
  let guard = 0;
  while (!terminal && guard++ < 60) {
    const resp = await postRpc(rpcUrl, 'message/send', { message: a2aMessage('user', profile.ownerId, contextId, outbound) });
    const task = resp.result as Task | undefined;
    if (!task) break;
    const { messages: inbound } = readKw(task.status.message);
    outbound = [];
    for (const m of inbound) {
      const r = step(driver, persona, { k: 'inbound', msg: m });
      outbound.push(...r.outbound);
      if (r.terminal) terminal = r.terminal;
    }
    if (terminal) break;
    if (task.status.state === 'failed') return null;
    if (!outbound.length) break; // no further progress
  }
  return terminal?.outcome === 'committed' ? terminal.artifact ?? null : null;
}
