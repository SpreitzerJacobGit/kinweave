/**
 * Kinweave combined server — the ONE thing you run.
 *  - serves the PWA (web/) over HTTP
 *  - runs the untrusted store-and-forward relay over WebSocket (/relay); it only
 *    ever holds signed ciphertext and verifies with the SAME portable crypto the
 *    phones use, so signatures match by construction
 *  - proxies Claude for onboarding so ANTHROPIC_API_KEY stays server-side
 *
 * Run: `npm start` (build the app first with `npm run build:web`), or `npm run dev`.
 * Structured so deploying to a cloud host later is just running this file there.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { networkInterfaces } from 'node:os';
import { WebSocketServer, type WebSocket } from 'ws';
import { fingerprint, signedBody, verifySig, type WireEnvelope } from '../src/portable/crypto';
import type { ClientMsg, ServerMsg } from '../src/portable/wire-protocol';
import { CommunityBoardStore, handleCommunityMsg } from '../src/net/community-board';
import { IntentBoardStore, handleIntentMsg } from '../src/net/intent-board';
import { makeLLM, type ProviderConfig } from '../src/ai/providers';
import { runOnboardingTurn, extractDraft } from '../src/ai/onboarding';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WEB = join(ROOT, 'web');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

// ---- relay (store-and-forward, ciphertext only) ---------------------------

interface Stored {
  mailId: string;
  env: WireEnvelope;
}

function attachRelay(wss: WebSocketServer): void {
  const mail = new Map<string, Stored[]>();
  const subs = new Map<string, WebSocket>();
  const board = new CommunityBoardStore();
  const intents = new IntentBoardStore();
  let counter = 0;

  wss.on('connection', (ws) => {
    let requested = '';
    let nonce = '';
    let authed = '';
    const reply = (m: ServerMsg) => ws.send(JSON.stringify(m));
    const deliver = (sock: WebSocket, s: Stored) => sock.send(JSON.stringify({ t: 'deliver', mailId: s.mailId, env: s.env } satisfies ServerMsg));

    ws.on('message', (raw) => {
      let m: ClientMsg;
      try {
        m = JSON.parse(raw.toString()) as ClientMsg;
      } catch {
        return;
      }
      if (m.t === 'send') {
        if (!verifySig(m.env.from, signedBody(m.env), m.env.sig)) return reply({ t: 'rejected', reason: 'bad-signature' });
        const stored: Stored = { mailId: `mail-${++counter}`, env: m.env };
        const q = mail.get(m.env.to) ?? [];
        q.push(stored);
        mail.set(m.env.to, q);
        const live = subs.get(m.env.to);
        if (live && live.readyState === 1) deliver(live, stored);
        reply({ t: 'accepted' });
      } else if (m.t === 'subscribe') {
        requested = m.fingerprint;
        nonce = `nonce-${++counter}-${requested}`;
        reply({ t: 'challenge', nonce });
      } else if (m.t === 'auth') {
        if (fingerprint(m.pubKey) !== requested) return reply({ t: 'auth_rejected', reason: 'fingerprint-mismatch' });
        if (!verifySig(m.pubKey, nonce, m.sig)) return reply({ t: 'auth_rejected', reason: 'bad-signature' });
        authed = requested;
        subs.set(authed, ws);
        reply({ t: 'subscribed' });
        for (const s of mail.get(authed) ?? []) deliver(ws, s);
      } else if (m.t === 'ack') {
        if (!authed) return;
        mail.set(authed, (mail.get(authed) ?? []).filter((s) => !m.mailIds.includes(s.mailId)));
      } else if (m.t === 'post_beacon' || m.t === 'sub_community' || m.t === 'unsub_community') {
        handleCommunityMsg(board, ws, m, (msg) => ws.send(JSON.stringify(msg)));
      } else if (m.t === 'post_call' || m.t === 'sub_calls' || m.t === 'unsub_calls') {
        handleIntentMsg(intents, ws, m, (msg) => ws.send(JSON.stringify(msg)));
      }
    });
    ws.on('close', () => {
      if (authed && subs.get(authed) === ws) subs.delete(authed);
      board.removeSocket(ws);
      intents.removeSocket(ws);
    });
  });
}

// ---- HTTP (static app + Claude proxy) -------------------------------------

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => resolve(b));
  });
}

function serveFile(res: ServerResponse, path: string): void {
  if (!existsSync(path)) {
    // SPA fallback — the pairing payload lives in the URL fragment (client-only).
    path = join(WEB, 'index.html');
  }
  if (!existsSync(path)) {
    res.writeHead(404).end('build the app first: npm run build:web');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' });
  res.end(readFileSync(path));
}

/** The host's default provider, if the deployer set one. */
function hostLLMConfig(): ProviderConfig | null {
  const p = process.env.LLM_PROVIDER;
  const k = process.env.LLM_API_KEY;
  if (p && k) return { provider: p, apiKey: k, model: process.env.LLM_MODEL, baseURL: process.env.LLM_BASE_URL };
  if (process.env.ANTHROPIC_API_KEY) return { provider: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY, model: process.env.LLM_MODEL };
  return null;
}

async function handleOnboard(req: IncomingMessage, res: ServerResponse, kind: 'chat' | 'extract'): Promise<void> {
  const body = JSON.parse((await readBody(req)) || '{}') as {
    messages: { role: 'user' | 'assistant'; content: string }[];
    provider?: ProviderConfig; // per-user "bring your own key"
  };
  // Per-user key wins; otherwise the host's default; otherwise no AI.
  const cfg = body.provider?.apiKey ? body.provider : hostLLMConfig();
  if (!cfg) {
    res.writeHead(501, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'no_ai', message: 'No AI provider configured. Choose one in the app (bring your own key), or set LLM_PROVIDER + LLM_API_KEY (or ANTHROPIC_API_KEY) on the server.' }));
    return;
  }
  try {
    const llm = makeLLM(cfg);
    if (kind === 'chat') {
      const reply = await runOnboardingTurn(llm, body.messages);
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ reply }));
    } else {
      const draft = await extractDraft(llm, body.messages);
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ draft }));
    }
  } catch (e) {
    res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: String((e as Error).message) }));
  }
}

export interface RunningServer {
  port: number;
  close: () => Promise<void>;
}

export function startServer(port = Number(process.env.PORT ?? 8788)): Promise<RunningServer> {
  const http = createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0]!;
    if (req.method === 'POST' && url === '/api/onboard') return void handleOnboard(req, res, 'chat');
    if (req.method === 'POST' && url === '/api/extract') return void handleOnboard(req, res, 'extract');
    if (req.method !== 'GET') return void res.writeHead(405).end();
    const rel = url === '/' ? 'index.html' : url.replace(/^\//, '');
    serveFile(res, rel === 'app.js' ? join(WEB, 'dist', 'app.js') : join(WEB, rel));
  });
  const wss = new WebSocketServer({ server: http, path: '/relay' });
  attachRelay(wss);

  return new Promise((resolve) => {
    http.listen(port, '0.0.0.0', () => {
      const addr = http.address();
      const p = typeof addr === 'object' && addr ? addr.port : port;
      resolve({
        port: p,
        close: () => new Promise((r) => http.close(() => wss.close(() => r()))),
      });
    });
  });
}

function lanUrls(port: number): string[] {
  const out: string[] = [];
  for (const iface of Object.values(networkInterfaces())) {
    for (const net of iface ?? []) {
      if (net.family === 'IPv4' && !net.internal) out.push(`http://${net.address}:${port}`);
    }
  }
  return out;
}

const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  startServer().then(({ port }) => {
    process.stdout.write(`\nKinweave running. Open on your phones (same Wi-Fi):\n`);
    for (const u of lanUrls(port)) process.stdout.write(`   ${u}\n`);
    process.stdout.write(`   (local: http://localhost:${port})\n`);
    const host = hostLLMConfig();
    process.stdout.write(host ? `AI onboarding: ON (host default: ${host.provider})\n\n` : `AI onboarding: OFF (users bring their own key, or set LLM_PROVIDER+LLM_API_KEY / ANTHROPIC_API_KEY)\n\n`);
  });
}
