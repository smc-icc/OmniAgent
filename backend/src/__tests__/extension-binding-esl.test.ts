import { createServer, type Server, type Socket } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../config/env.js', () => ({ env: {} }));
vi.mock('../modules/access/access.db.js', () => ({ database: vi.fn(), execute: vi.fn(), rows: vi.fn(), transaction: vi.fn() }));
import { freeswitchApi } from '../modules/extension-binding/sip-revocation.js';
const servers: Server[] = [];
const sockets = new Set<Socket>();
afterEach(async () => {
  for (const socket of sockets) socket.destroy();
  sockets.clear();
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
  vi.unstubAllEnvs();
});
async function endpoint(separator: string, body: string, fragmented = false) {
  const server = createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.write('Content-Type: auth/request' + separator + separator);
    let input = '';
    let authenticated = false;
    socket.on('data', chunk => {
      input += chunk.toString();
      while (input.includes('\n\n')) {
        const at = input.indexOf('\n\n');
        const command = input.slice(0, at);
        input = input.slice(at + 2);
        if (!authenticated) {
          expect(command).toBe('auth synthetic-fixture-password');
          authenticated = true;
          socket.write('Content-Type: command/reply' + separator + 'Reply-Text: +OK accepted' + separator + separator);
        } else {
          expect(command).toBe('api status');
          const frame = Buffer.from('Content-Type: api/response' + separator + 'Content-Length: ' + Buffer.byteLength(body) + separator + separator + body);
          if (fragmented) {
            socket.write(frame.subarray(0, frame.length - 2));
            setImmediate(() => socket.write(frame.subarray(frame.length - 2)));
          } else socket.write(frame);
        }
      }
    });
  });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  vi.stubEnv('SIP_ESL_HOST', '127.0.0.1');
  vi.stubEnv('SIP_ESL_PORT', String((server.address() as { port: number }).port));
  vi.stubEnv('SIP_ESL_PASSWORD', 'synthetic-fixture-password');
}
describe('FreeSWITCH ESL API frame parsing', () => {
  it('returns LF response bytes exactly', async () => {
    await endpoint('\n', 'UP 42 seconds\n');
    await expect(freeswitchApi('status')).resolves.toBe('UP 42 seconds\n');
  });
  it('returns CRLF response bytes exactly without prepending delimiter bytes', async () => {
    await endpoint('\r\n', 'UP 42 seconds\r\n');
    await expect(freeswitchApi('status')).resolves.toBe('UP 42 seconds\r\n');
  });
  it('handles a fragmented CRLF response including a UTF-8 body', async () => {
    await endpoint('\r\n', '{"状态":"正常"}', true);
    await expect(freeswitchApi('status')).resolves.toBe('{"状态":"正常"}');
  });
});
