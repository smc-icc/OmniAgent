import { describe, it, expect } from 'vitest';
import { getTestApp, getAuthToken } from './setup.js';

describe('Contacts Module', () => {
  const accId = 1;

  it('GET /api/v1/accounts/:id/contacts — list', async () => {
    const app = await getTestApp();
    const token = await getAuthToken();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/accounts/${accId}/contacts`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('POST + DELETE /api/v1/accounts/:id/contacts — create then destroy', async () => {
    const app = await getTestApp();
    const token = await getAuthToken();
    const createRes = await app.inject({
      method: 'POST',
      url: `/api/v1/accounts/${accId}/contacts`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Test Contact', email: 'test.contact@test.local' },
    });
    expect(createRes.statusCode).toBe(200);
    const contact = JSON.parse(createRes.body);
    expect(contact.id).toBeDefined();

    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/accounts/${accId}/contacts/${contact.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(delRes.statusCode).toBe(200);
  });

  it('GET /api/v1/accounts/:id/contacts/search — search', async () => {
    const app = await getTestApp();
    const token = await getAuthToken();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/accounts/${accId}/contacts/search?q=alice`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('POST /api/v1/accounts/:id/companies — create company', async () => {
    const app = await getTestApp();
    const token = await getAuthToken();
    const uniqueDomain = `testcorp-${Date.now()}.com`;
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/accounts/${accId}/companies`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'TestCorp', domain: uniqueDomain },
    });
    expect(res.statusCode).toBe(200);
  });

  it('GET /api/v1/accounts/:id/custom_attribute_definitions — list attrs', async () => {
    const app = await getTestApp();
    const token = await getAuthToken();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/accounts/${accId}/custom_attribute_definitions`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });
});
