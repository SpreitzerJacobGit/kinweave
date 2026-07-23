/**
 * A2A HTTP server for a Kinweave agent. Serves the Agent Card at
 * /.well-known/agent-card.json (GET) and the JSON-RPC endpoint at / (POST), so
 * any A2A client can discover and message it. Thin — the bridge does the work.
 */

import { createServer } from 'node:http';
import { A2ABridge } from './bridge';
import type { JsonRpcRequest } from './types';

export interface RunningA2A {
  port: number;
  url: string;
  close: () => Promise<void>;
}

export function startA2AServer(bridge: A2ABridge, port = 0, host = '127.0.0.1'): Promise<RunningA2A> {
  const http = createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0];
    if (req.method === 'GET' && url === '/.well-known/agent-card.json') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(bridge.agentCard()));
      return;
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        let out;
        try {
          out = bridge.handleRpc(JSON.parse(body) as JsonRpcRequest);
        } catch {
          out = { jsonrpc: '2.0' as const, id: null, error: { code: -32700, message: 'parse error' } };
        }
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out));
      });
      return;
    }
    res.writeHead(404).end();
  });

  return new Promise((resolve) => {
    http.listen(port, host, () => {
      const addr = http.address();
      const p = typeof addr === 'object' && addr ? addr.port : port;
      // Advertise a routable address (never 0.0.0.0); a deploy can override with KINWEAVE_A2A_URL.
      const advHost = host === '0.0.0.0' ? '127.0.0.1' : host;
      bridge.url = process.env.KINWEAVE_A2A_URL ?? `http://${advHost}:${p}/`;
      resolve({ port: p, url: bridge.url, close: () => new Promise((r) => http.close(() => r())) });
    });
  });
}
