/**
 * Minimal A2A (Agent2Agent) protocol types — the shapes a generic A2A client
 * expects. Enough to be compatible: Agent Card + JSON-RPC message/send + tasks/get
 * + Task/Message/Part/TaskState. See spec/09-a2a-bridge.md.
 */

export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  tags: string[];
  examples?: string[];
}

export interface AgentExtension {
  uri: string;
  description?: string;
  required?: boolean;
  params?: Record<string, unknown>;
}

export interface AgentCapabilities {
  streaming?: boolean;
  pushNotifications?: boolean;
  extensions?: AgentExtension[];
}

export interface AgentCard {
  protocolVersion: string;
  name: string;
  description: string;
  url: string; // JSON-RPC endpoint
  version: string;
  preferredTransport?: string;
  capabilities: AgentCapabilities;
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: AgentSkill[];
  provider?: { organization: string; url: string };
}

export type Part =
  | { kind: 'text'; text: string }
  | { kind: 'data'; data: Record<string, unknown> };

export interface A2AMessage {
  role: 'user' | 'agent';
  parts: Part[];
  messageId: string;
  kind: 'message';
  contextId?: string;
  taskId?: string;
}

export type TaskState =
  | 'submitted'
  | 'working'
  | 'input-required'
  | 'completed'
  | 'canceled'
  | 'failed'
  | 'rejected'
  | 'auth-required'
  | 'unknown';

export interface TaskStatus {
  state: TaskState;
  message?: A2AMessage;
  timestamp?: string;
}

export interface Artifact {
  artifactId: string;
  name?: string;
  parts: Part[];
}

export interface Task {
  id: string;
  contextId: string;
  kind: 'task';
  status: TaskStatus;
  artifacts?: Artifact[];
  history?: A2AMessage[];
}

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number | null;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}
