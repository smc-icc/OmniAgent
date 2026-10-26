import assert from 'node:assert/strict';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { PrismaClient } from '@prisma/client';
const pg = new PrismaClient(), auth = Fastify();
try {
  await auth.register(jwt, { secret: process.env.JWT_SECRET });
  const account = Number(process.env.OMNI_ACCESS_ACCOUNT_ID || 1);
  const admin = await pg.account_users.findFirst({ where: { account_id: account, role: 0 } }); assert.ok(admin);
  const token = auth.jwt.sign({ id: admin.user_id }, { expiresIn: '60s' });
  const results = [];
  for (const [url, expected, authenticated] of [
    ['/health', 200, false], ['/api/access/me', 401, false], ['/api/v1/monitor/overview', 401, false],
    ['/api/access/me', 200, true], ['/api/access/bootstrap', 200, true],
    [`/api/v1/accounts/${account}/conversations`, 200, true], ['/api/customers', 200, true],
    ['/api/platform-config/overview', 200, true], ['/api/sms-templates', 200, true], ['/api/bi/catalog', 200, true],
    ['/api/v1/accounts/999999/conversations', 403, true], ['/uploads/not-authorized.txt', 403, false],
  ]) {
    const r = await fetch(`http://127.0.0.1:3001${url}`, { headers: authenticated ? { authorization: `Bearer ${token}` } : {} });
    const text = await r.text();
    results.push({ url, authenticated, status: r.status, expected });
    if (r.status !== expected) console.error(`Unexpected response ${url}: ${text.slice(0, 250)}`);
    if (url === '/api/access/me' && authenticated) assert.ok(JSON.parse(text).permissions.includes('conversation.delete'));
  }
  console.log(JSON.stringify({ passed: results.every(r => r.status === r.expected), results }, null, 2));
  assert.ok(results.every(r => r.status === r.expected), 'All deployed endpoint checks must pass');
} finally { await pg.$disconnect(); await auth.close(); }
