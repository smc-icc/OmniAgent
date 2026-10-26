import { describe, it, expect } from 'vitest';
import { getTestApp, getAuthToken } from './setup.js';

describe('Accounts Module', () => {
  const accId = 1;

  it('GET /api/v1/accounts/:id — show account', async () => {
    const app = await getTestApp();
    const token = await getAuthToken();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/accounts/${accId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('GET /api/v1/accounts/:id/agents — list agents', async () => {
    const app = await getTestApp();
    const token = await getAuthToken();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/accounts/${accId}/agents`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(JSON.parse(res.body))).toBe(true);
  });

  it('GET /api/v1/accounts/:id/teams — list teams', async () => {
    const app = await getTestApp();
    const token = await getAuthToken();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/accounts/${accId}/teams`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('GET /api/v1/accounts/:id/custom_roles — list roles', async () => {
    const app = await getTestApp();
    const token = await getAuthToken();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/accounts/${accId}/custom_roles`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('GET /api/v1/accounts/:id/agent_capacity_policies — list capacity', async () => {
    const app = await getTestApp();
    const token = await getAuthToken();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/accounts/${accId}/agent_capacity_policies`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('POST + DELETE /api/v1/accounts/:id/agents — create then destroy agent', async () => {
    const app = await getTestApp();
    const token = await getAuthToken();
    const createRes = await app.inject({
      method: 'POST',
      url: `/api/v1/accounts/${accId}/agents`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Test Agent', email: 'agent_test@test.local', role: 'agent' },
    });
    expect(createRes.statusCode).toBe(200);
    const { id } = JSON.parse(createRes.body);
    expect(id).toBeDefined();

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/accounts/${accId}/agents/${id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(deleteRes.statusCode).toBe(200);
  });
});
