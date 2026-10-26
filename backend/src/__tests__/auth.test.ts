import { describe, it, expect } from 'vitest';
import { getTestApp, getAuthToken } from './setup.js';

describe('Auth Module', () => {
  it('POST /auth/sign_in — login with valid credentials', async () => {
    const app = await getTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/sign_in',
      payload: { email: 'test@omniagent.local', password: 'password123' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data).toBeDefined();
    expect(body.data.email).toBe('test@omniagent.local');
    // Token is in response body (Chatwoot-style), not HTTP header in inject mode
    expect(body.headers?.['access-token']).toBeDefined();
  });

  it('POST /auth/sign_in — reject invalid credentials', async () => {
    const app = await getTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/sign_in',
      payload: { email: 'test@omniagent.local', password: 'wrong' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('GET /auth/validate_token — validate JWT', async () => {
    const app = await getTestApp();
    const token = await getAuthToken();
    const res = await app.inject({
      method: 'GET',
      url: '/auth/validate_token',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
  });

  it('POST /auth/sign_in — second login invalidates the first token', async () => {
    const app = await getTestApp();
    const first = await app.inject({
      method: 'POST',
      url: '/auth/sign_in',
      payload: { email: 'test@omniagent.local', password: 'password123', device_id: 'device-first-0001' },
    });
    const firstToken = JSON.parse(first.body).headers['access-token'];
    const second = await app.inject({
      method: 'POST',
      url: '/auth/sign_in',
      payload: { email: 'test@omniagent.local', password: 'password123', device_id: 'device-second-0002' },
    });
    const secondToken = JSON.parse(second.body).headers['access-token'];
    const stale = await app.inject({
      method: 'GET',
      url: '/auth/validate_token',
      headers: { authorization: `Bearer ${firstToken}` },
    });
    const fresh = await app.inject({
      method: 'GET',
      url: '/auth/validate_token',
      headers: { authorization: `Bearer ${secondToken}` },
    });
    expect(stale.statusCode).toBe(401);
    expect(JSON.parse(stale.body).error_code).toBe('session_replaced');
    expect(fresh.statusCode).toBe(200);
  });

  it('GET /auth/validate_token — reject missing token', async () => {
    const app = await getTestApp();
    const res = await app.inject({
      method: 'GET',
      url: '/auth/validate_token',
    });
    expect(res.statusCode).toBe(401);
  });

  it('DELETE /auth/sign_out — logout', async () => {
    const app = await getTestApp();
    const token = await getAuthToken();
    const res = await app.inject({
      method: 'DELETE',
      url: '/auth/sign_out',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('GET /api/v1/profile — get current user profile', async () => {
    const app = await getTestApp();
    const token = await getAuthToken();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/profile',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('PUT /api/v1/profile — update profile', async () => {
    const app = await getTestApp();
    const token = await getAuthToken();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/profile',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Updated Name' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('POST /auth/password — request reset', async () => {
    const app = await getTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/password',
      payload: { email: 'test@omniagent.local' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('POST /platform/api/v1/users/:id/token — generate platform token', async () => {
    const app = await getTestApp();
    const token = await getAuthToken();
    const res = await app.inject({
      method: 'POST',
      url: '/platform/api/v1/users/1/token',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.token).toBeDefined();
  });

  it('GET /health — health check (no auth)', async () => {
    const app = await getTestApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).status).toBe('ok');
  });
});
