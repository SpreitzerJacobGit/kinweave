/**
 * Start a Kinweave agent as a long-running A2A service (for curl / external A2A
 * clients). `npm run a2a:serve` — stays up until Ctrl+C.
 *   env: PORT (default 41414)
 */

import { A2ABridge } from './bridge';
import { startA2AServer } from './server';
import { Node } from '../portable/crypto';
import { ava } from '../sim/fixtures';

const bridge = new A2ABridge(new Node(), ava, 'Kinweave demo agent');
const s = await startA2AServer(bridge, Number(process.env.PORT ?? 41414), '0.0.0.0');
process.stdout.write(`Kinweave A2A agent live:\n  Agent Card: http://127.0.0.1:${s.port}/.well-known/agent-card.json\n  JSON-RPC:   ${s.url}\n(Ctrl+C to stop)\n`);
