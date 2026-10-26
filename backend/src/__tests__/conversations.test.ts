import { describe, it, expect } from 'vitest';
import { getTestApp, getAuthToken } from './setup.js';

describe('Conversations Module', () => {
  const accId = 1;
  const inboxId = 1;

  it('GET /api/v1/accounts/:id/conversations — list', async () => {
    const app = await getTestApp();
    const token = await getAuthToken();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/accounts/${accId}/conversations`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.payload).toBeDefined();
  });

  it('POST + GET /api/v1/accounts/:id/conversations — create and show', async () => {
    const app = await getTestApp();
    const token = await getAuthToken();
    const createRes = await app.inject({
      method: 'POST',
      url: `/api/v1/accounts/${accId}/conversations`,
      headers: { authorization: `Bearer ${token}` },
      payload: { inbox_id: inboxId },
    });
    expect(createRes.statusCode).toBe(200);
    const conv = JSON.parse(createRes.body);
    expect(conv.id).toBeDefined();

    const showRes = await app.inject({
      method: 'GET',
      url: `/api/v1/accounts/${accId}/conversations/${conv.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(showRes.statusCode).toBe(200);
  });

  it('POST /api/v1/.../:id/messages — send message', async () => {
    const app = await getTestApp();
    const token = await getAuthToken();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/accounts/${accId}/conversations/2/messages`,
      headers: { authorization: `Bearer ${token}` },
      payload: { content: 'Test message', message_type: 'outgoing' },
    });
    expect(res.statusCode).toBe(200);
    const msg = JSON.parse(res.body);
    expect(msg.content).toBe('Test message');
  });

  it('GET /api/v1/.../:id/messages — list messages', async () => {
    const app = await getTestApp();
    const token = await getAuthToken();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/accounts/${accId}/conversations/2/messages`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('POST /api/v1/.../:id/assignments — assign', async () => {
    const app = await getTestApp();
    const token = await getAuthToken();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/accounts/${accId}/conversations/2/assignments`,
      headers: { authorization: `Bearer ${token}` },
      payload: { assignee_id: 1 },
    });
    expect(res.statusCode).toBe(200);
  });

  it('POST /api/v1/.../:id/toggle_status — toggle', async () => {
    const app = await getTestApp();
    const token = await getAuthToken();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/accounts/${accId}/conversations/2/toggle_status`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: 'resolved' },
    });
    expect(res.statusCode).toBe(200);
  });
});
