import { beforeAll, afterAll } from 'vitest';
import { buildApp } from '../app.js';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;

export async function getTestApp(): Promise<FastifyInstance> {
  if (!app) {
    app = await buildApp();
    await app.ready();
  }
  return app;
}

export async function closeTestApp(): Promise<void> {
  if (app) {
    await app.close();
  }
}

export async function getAuthToken(email = 'test@omniagent.local', password = 'password123'): Promise<string> {
  const app = await getTestApp();
  const res = await app.inject({
    method: 'POST',
    url: '/auth/sign_in',
    payload: { email, password },
  });
  const body = JSON.parse(res.body);
  // Token is returned in both response body and headers
  return (body.headers?.['access-token'] ?? body.data?.token ?? res.headers['access-token'] ?? '') as string;
}

beforeAll(async () => {
  await getTestApp();
});

afterAll(async () => {
  await closeTestApp();
});
