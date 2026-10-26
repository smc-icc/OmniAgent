import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import jwt from '@fastify/jwt';
import sensible from '@fastify/sensible';
import fastifyStatic from '@fastify/static';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import nodemailer from 'nodemailer';
import mysql from 'mysql2';
import { createHmac } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const db = vi.hoisted(() => ({ user: vi.fn(), membership: vi.fn(), enabled: vi.fn() }));
vi.mock('../plugins/db.js', () => ({ prisma: {
  users: { findUnique: db.user }, account_users: { findFirst: db.membership },
} }));
vi.mock('../modules/access/access.enabled.js', () => ({ assertOperatorEnabled: db.enabled }));
vi.mock('../config/env.js', () => ({ env: { CCS_WORK_NO_FIELD: 'uid' } }));
import authPlugin from '../plugins/auth.js';
import { occupyLogin, resetLoginSessions } from '../shared/services/login-session.js';

// This fixture exercises the actual auth plugin/JWT verifier, without Prisma,
// Redis, SMTP, or the full application's startup side effects.
const secret = 'synthetic-only-strong-test-secret-not-customer-material';
let app: FastifyInstance;
const dirs: string[] = [];
function manualJwt(header: object, payload: object, key = secret) {
  const head = Buffer.from(JSON.stringify(header)).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${head}.${body}.${createHmac('sha256', key).update(`${head}.${body}`).digest('base64url')}`;
}
async function tempDir() { const dir = await mkdtemp(join(tmpdir(), 'smc-release-')); dirs.push(dir); return dir; }
beforeEach(async () => {
  resetLoginSessions(); vi.resetAllMocks();
  db.user.mockResolvedValue({ id: 41, email: 'synthetic@example.invalid', name: 'Synthetic', uid: '41' });
  db.membership.mockResolvedValue({ account: { id: 7, name: 'Synthetic tenant' } });
  db.enabled.mockResolvedValue(undefined);
  app = Fastify();
  await app.register(sensible);
  await app.register(jwt, { secret, sign: { expiresIn: '30d' } });
});
afterEach(async () => { await app.close(); resetLoginSessions(); await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

async function protectedFixture() {
  await app.register(authPlugin);
  app.get('/private/:account_id', { preHandler: [app.authenticate, app.loadAccount] }, async req => ({ user: req.currentUser?.id, account: req.currentAccount?.id }));
  await app.ready();
}

describe('release JWT and actual authentication plugin compatibility', () => {
  it('accepts a current signed session and loads the correct account', async () => {
    const { session } = occupyLogin({ userId: 41, deviceId: 'synthetic-device' });
    await protectedFixture();
    const token = app.jwt.sign({ id: 41, sid: session.sessionId });
    expect((await app.inject({ url: '/private/7', headers: { authorization: `Bearer ${token}` } })).json()).toEqual({ user: 41, account: 7 });
    expect(db.membership).toHaveBeenCalledWith(expect.objectContaining({ where: { account_id: 7, user_id: 41 } }));
  });
  it('rejects replaced login sessions rather than loading another identity', async () => {
    const { session } = occupyLogin({ userId: 41, deviceId: 'old-synthetic-device' });
    const token = app.jwt.sign({ id: 41, sid: session.sessionId });
    occupyLogin({ userId: 41, deviceId: 'new-synthetic-device' });
    await protectedFixture();
    expect((await app.inject({ url: '/private/7', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(401);
    expect(db.membership).not.toHaveBeenCalled();
  });
  it.each(['missing', 'wrong-secret', 'expired', 'unsigned', 'unknown-critical-extension'])('rejects %s tokens on HTTP and the Socket.IO shared verifier', async kind => {
    await protectedFixture();
    const payload = { id: 41, exp: Math.floor(Date.now() / 1000) + 60 };
    let token = '';
    if (kind === 'wrong-secret') token = manualJwt({ alg: 'HS256', typ: 'JWT' }, payload, 'different-synthetic-secret');
    if (kind === 'expired') token = manualJwt({ alg: 'HS256', typ: 'JWT' }, { ...payload, exp: 1 });
    if (kind === 'unsigned') token = `${Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.`;
    if (kind === 'unknown-critical-extension') token = manualJwt({ alg: 'HS256', crit: ['unknown'], unknown: true }, payload);
    expect(() => app.jwt.verify(token)).toThrow();
    const res = await app.inject({ url: '/private/7', headers: token ? { authorization: `Bearer ${token}` } : {} });
    expect(res.statusCode).toBe(401);
    expect(db.user).not.toHaveBeenCalled();
  });
  it('does not confuse cached token identities', async () => {
    const a = app.jwt.sign({ id: 41 }); const b = app.jwt.sign({ id: 42 });
    for (let i = 0; i < 10; i++) {
      expect((app.jwt.verify(a) as { id: number }).id).toBe(41);
      expect((app.jwt.verify(b) as { id: number }).id).toBe(42);
    }
  });
});

describe('release static files and Swagger integration', () => {
  it('serves assets without allowing traversal outside the static root', async () => {
    const root = await tempDir(); const child = join(root, 'assets');
    const { mkdir } = await import('node:fs/promises'); await mkdir(child);
    await writeFile(join(child, 'ok.txt'), 'synthetic-public'); await writeFile(join(root, 'secret.txt'), 'synthetic-private');
    await app.register(fastifyStatic, { root: child, prefix: '/assets/' });
    expect((await app.inject('/assets/ok.txt')).body).toBe('synthetic-public');
    for (const url of ['/assets/../secret.txt', '/assets/%2e%2e/secret.txt', '/assets/%2e%2e%2fsecret.txt', '/assets/%252e%252e%252fsecret.txt']) {
      const res = await app.inject(url); expect(res.statusCode).toBe(404); expect(res.body).not.toContain('synthetic-private');
    }
  });
  it('registers Swagger UI with Fastify 5, serves UI assets and JSON', async () => {
    await app.register(swagger, { openapi: { info: { title: 'Synthetic', version: '0' } } });
    await app.register(swaggerUi, { routePrefix: '/docs' });
    expect((await app.inject('/docs/json')).json().openapi).toMatch(/^3\./);
    expect((await app.inject('/docs/')).statusCode).toBe(200);
    expect((await app.inject('/docs/static/swagger-ui.css')).statusCode).toBe(200);
  });
});

describe('release mail and MySQL public APIs (no external services)', () => {
  it('builds Unicode MIME, HTML and binary attachments with the real mailer', async () => {
    const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
    const info = await transport.sendMail({ from: 'synthetic@example.invalid', to: 'Receiver <receiver@example.invalid>', subject: 'Test 邮件', text: 'Text body', html: '<b>HTML body</b>', attachments: [{ filename: 'fixture.txt', content: Buffer.from('synthetic-attachment') }] });
    const message = info.message.toString();
    expect(info.envelope.to).toEqual(['receiver@example.invalid']);
    expect(message).toContain('multipart/mixed'); expect(message).toContain('multipart/alternative'); expect(message).toContain('fixture.txt'); expect(message).toContain(Buffer.from('synthetic-attachment').toString('base64'));
  });
  it('retains MySQL parameter/identifier escaping and promise pool API', async () => {
    expect(mysql.format('SELECT ?? FROM t WHERE id=? AND name=?', ['value', 41, "a'b"])).toBe("SELECT `value` FROM t WHERE id=41 AND name='a\\'b'");
    const pool = mysql.createPool({ host: '127.0.0.1', port: 1, user: 'synthetic', database: 'synthetic' });
    expect(typeof pool.promise().query).toBe('function'); await pool.promise().end();
  });
});

describe('reviewed Prisma config-scoped deepmerge override', () => {
  it('uses the exact override and preserves record/array config merges', async () => {
    const require = createRequire(import.meta.url);
    const configPath = require.resolve('@prisma/config', { paths: [dirname(require.resolve('prisma/config'))] });
    const configRequire = createRequire(configPath);
    const { deepmerge } = await import(pathToFileURL(configRequire.resolve('deepmerge-ts')).href);
    expect(deepmerge({ schema: 'schema.prisma', migrations: { path: './migrations' }, list: ['a'] }, { migrations: { seed: 'synthetic' }, list: ['b'] })).toEqual({ schema: 'schema.prisma', migrations: { path: './migrations', seed: 'synthetic' }, list: ['a', 'b'] });
    const left: Record<string, unknown> = {}; left.self = left;
    const right: Record<string, unknown> = {}; right.self = right;
    const result = deepmerge(left, right); expect(result.self).toBe(result);
  });
  it('loads actual Prisma config from a temporary directory without opening a database', async () => {
    const require = createRequire(import.meta.url);
    const configPath = require.resolve('@prisma/config', { paths: [dirname(require.resolve('prisma/config'))] });
    const { loadConfigFromFile } = await import(pathToFileURL(configPath).href);
    const root = await tempDir(); const filename = join(root, 'prisma.config.cjs');
    await writeFile(filename, "module.exports = { schema: './schema.prisma', migrations: { path: './migrations' } };\n");
    const result = await loadConfigFromFile({ configRoot: root, configFile: filename });
    expect(result.error).toBeUndefined(); expect(result.config.schema).toBe(join(root, 'schema.prisma'));
    expect(result.config.migrations.path).toBe(join(root, 'migrations'));
  });
});
