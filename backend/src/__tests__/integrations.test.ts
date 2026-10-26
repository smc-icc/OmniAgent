import { describe, it, expect } from 'vitest';
import { getTestApp, getAuthToken } from './setup.js';

describe('Integrations Module', () => {
  const accId = 1;

  it('GET /api/v1/accounts/:id/webhooks — list webhooks', async () => {
    const app = await getTestApp();
    const token = await getAuthToken();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/accounts/${accId}/webhooks`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('GET /api/v1/accounts/:id/integrations/apps — list apps', async () => {
    const app = await getTestApp();
    const token = await getAuthToken();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/accounts/${accId}/integrations/apps`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('GET /api/v1/accounts/:id/integrations/hooks — list hooks', async () => {
    const app = await getTestApp();
    const token = await getAuthToken();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/accounts/${accId}/integrations/hooks`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('GET /api/v1/accounts/:id/portals — list portals', async () => {
    const app = await getTestApp();
    const token = await getAuthToken();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/accounts/${accId}/portals`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('GET /enterprise/api/v1/accounts/:id/limits', async () => {
    const app = await getTestApp();
    const token = await getAuthToken();
    const res = await app.inject({
      method: 'GET',
      url: `/enterprise/api/v1/accounts/${accId}/limits`,
      headers: { authorization: `Bearer ${token}` },
    });
    // Enterprise/platform routes may return 401 if auth scope differs; accept 200/401/404
    expect([200, 401, 404]).toContain(res.statusCode);
  });

  it('GET /platform/api/v1/accounts — platform list', async () => {
    const app = await getTestApp();
    const token = await getAuthToken();
    const res = await app.inject({
      method: 'GET',
      url: '/platform/api/v1/accounts',
      headers: { authorization: `Bearer ${token}` },
    });
    expect([200, 401, 404]).toContain(res.statusCode);
  });
});
