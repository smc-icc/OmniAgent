import { describe, it, expect } from 'vitest';
import { getTestApp, getAuthToken } from './setup.js';

describe('Captain Module', () => {
  const accId = 1;

  it('GET /api/v1/accounts/:id/captain/preferences — show', async () => {
    const app = await getTestApp();
    const token = await getAuthToken();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/accounts/${accId}/captain/preferences`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('PUT /api/v1/accounts/:id/captain/preferences — update', async () => {
    const app = await getTestApp();
    const token = await getAuthToken();
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/accounts/${accId}/captain/preferences`,
      headers: { authorization: `Bearer ${token}` },
      payload: { default_model: 'gpt-4o', temperature: 0.5 },
    });
    expect(res.statusCode).toBe(200);
  });

  it('GET /api/v1/accounts/:id/captain/assistants — list', async () => {
    const app = await getTestApp();
    const token = await getAuthToken();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/accounts/${accId}/captain/assistants`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('GET /api/v1/accounts/:id/captain/assistants/tools — list tools', async () => {
    const app = await getTestApp();
    const token = await getAuthToken();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/accounts/${accId}/captain/assistants/tools`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('GET /api/v1/accounts/:id/captain/copilot_threads — list threads', async () => {
    const app = await getTestApp();
    const token = await getAuthToken();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/accounts/${accId}/captain/copilot_threads`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('POST /api/v1/.../captain/tasks/rewrite — rewrite', async () => {
    const app = await getTestApp();
    const token = await getAuthToken();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/accounts/${accId}/captain/tasks/rewrite`,
      headers: { authorization: `Bearer ${token}` },
      payload: { content: 'plz help urgent' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.task).toBe('rewrite');
  });
});
