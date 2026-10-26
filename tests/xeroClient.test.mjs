import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createXeroClient } from '../lib/xeroClient.mjs';

// A store that counts its loads, and a fetch that answers every API call with one short
// page, so a paged list ends after a single call per path.
function setup({ expiry = Date.now() + 30 * 60 * 1000 } = {}) {
  const calls = { load: 0, save: 0, token: 0, api: 0 };
  const store = {
    async load() { calls.load++; return { accessToken: 'stored', refreshToken: 'r1', expiry }; },
    async save() { calls.save++; },
  };
  globalThis.fetch = async url => {
    if (String(url).includes('/connect/token')) {
      calls.token++;
      return new Response(JSON.stringify({ access_token: 'fresh', refresh_token: 'r2', expires_in: 1800 }));
    }
    calls.api++;
    return new Response(JSON.stringify({ Invoices: [] }));
  };
  const client = createXeroClient({ clientId: 'id', clientSecret: 'secret', tenantId: 't', store });
  return { client, calls };
}

test('a valid stored token is read from the store once, not on every call', async () => {
  const { client, calls } = setup();
  for (let i = 0; i < 5; i++) await client.get('/Invoices');
  assert.equal(calls.api, 5);
  assert.equal(calls.load, 1);
  assert.equal(calls.token, 0);
});

test('an expired stored token is refreshed once, then the fresh one is reused', async () => {
  const { client, calls } = setup({ expiry: Date.now() - 1000 });
  for (let i = 0; i < 3; i++) await client.get('/Invoices');
  assert.equal(calls.token, 1);
  assert.equal(calls.save, 1);
  assert.equal(calls.api, 3);
  // One load to find the token expired, one inside the refresh for the refresh token
  assert.equal(calls.load, 2);
});

test('a binary read returns the exact bytes, with the Accept header it was given', async () => {
  const { client } = setup();
  const pdf = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0xff, 0x00, 0xe2, 0x80]);   // "%PDF" then non-UTF-8 bytes
  let accept = '';
  globalThis.fetch = async (url, init) => {
    accept = init.headers.Accept;
    return new Response(pdf, { headers: { 'Content-Type': 'application/pdf' } });
  };
  const out = await client.get('/Invoices/abc', { headers: { Accept: 'application/pdf' }, binary: true });
  assert.equal(accept, 'application/pdf');
  assert.ok(Buffer.isBuffer(out));
  assert.deepEqual([...out], [...pdf]);
});
