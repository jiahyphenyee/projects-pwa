// A small Xero API client with no dependencies, so both the app (lib/xero.js) and the
// one-off scripts can use it. Where the tokens live is the caller's business: it passes a
// `store` with load() and save(), and the client does the OAuth refresh dance against it.
//
// Refresh tokens are single-use, so a refresh is serialised: concurrent requests share one
// in-flight refresh rather than each spending the token. Xero allows the previous refresh
// token to be retried for a short grace period if a response is lost, but nothing here
// relies on it.
//
// Nothing in this file writes to Xero on its own; `post`/`put` exist for Phase 5, which
// wraps them in the single dry-run-aware function the build plan requires.

const TOKEN_URL = 'https://identity.xero.com/connect/token';
const API_URL   = 'https://api.xero.com/api.xro/2.0';
const REFRESH_AHEAD_MS = 2 * 60 * 1000;
const PAGE_SIZE = 100;

export class XeroError extends Error {
  constructor(message, { status, body, path } = {}) {
    super(message);
    this.name = 'XeroError';
    this.status = status;
    this.body = body;
    this.path = path;
  }
}

export function createXeroClient({ clientId, clientSecret, tenantId, store, log = () => {} }) {
  if (!clientId || !clientSecret || !tenantId) throw new Error('Xero client id, secret and tenant id are required');
  let refreshing = null;

  async function refresh() {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      const { refreshToken } = await store.load();
      if (!refreshToken) throw new XeroError('No Xero refresh token stored — run scripts/xero-auth.mjs');
      const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
        },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
      });
      const text = await res.text();
      if (!res.ok) throw new XeroError(`Xero token refresh failed (${res.status}): ${text}`, { status: res.status, body: text });
      const data = JSON.parse(text);
      const tokens = {
        accessToken:  data.access_token,
        refreshToken: data.refresh_token || refreshToken,
        expiry:       Date.now() + (Number(data.expires_in) || 1800) * 1000,
      };
      await store.save(tokens);
      log('token refreshed');
      return tokens.accessToken;
    })().finally(() => { refreshing = null; });
    return refreshing;
  }

  async function accessToken() {
    const { accessToken: token, expiry } = await store.load();
    if (token && Date.now() < Number(expiry) - REFRESH_AHEAD_MS) return token;
    return refresh();
  }

  /**
   * One API call. Retries once on 401 after a refresh, and waits out a 429 (Xero's limit
   * is 60 calls a minute) up to three times using the Retry-After header.
   */
  async function request(path, { method = 'GET', body, headers = {}, raw = false } = {}, attempt = 0) {
    const token = await accessToken();
    const res = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        'Authorization':  `Bearer ${token}`,
        'Xero-Tenant-Id': tenantId,
        'Accept':         'application/json',
        ...(body && !raw ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : (raw ? body : JSON.stringify(body)),
    });

    if (res.status === 401 && attempt === 0) {
      log(`401 on ${path}, refreshing and retrying`);
      await refresh();
      return request(path, { method, body, headers, raw }, attempt + 1);
    }
    if (res.status === 429 && attempt < 3) {
      const wait = (Number(res.headers.get('retry-after')) || 5) * 1000;
      log(`rate limited on ${path}, waiting ${wait / 1000}s`);
      await new Promise(r => setTimeout(r, wait));
      return request(path, { method, body, headers, raw }, attempt + 1);
    }

    const text = await res.text();
    if (!res.ok) {
      throw new XeroError(`Xero ${method} ${path} failed (${res.status}): ${text.slice(0, 500)}`, { status: res.status, body: text, path });
    }
    if (!text) return null;
    try { return JSON.parse(text); } catch { return text; }
  }

  /** Walk every page of a list endpoint, yielding each page's items. */
  async function* pages(path, key, params = {}) {
    for (let page = 1; ; page++) {
      const qs = new URLSearchParams({ ...params, page: String(page) });
      const data = await request(`${path}?${qs}`);
      const items = data?.[key] || [];
      if (items.length) yield items;
      if (items.length < PAGE_SIZE) return;
    }
  }

  return {
    get:  (path, opts) => request(path, { ...opts, method: 'GET' }),
    post: (path, body, opts) => request(path, { ...opts, method: 'POST', body }),
    put:  (path, body, opts) => request(path, { ...opts, method: 'PUT', body }),
    pages,
    refresh,
  };
}
