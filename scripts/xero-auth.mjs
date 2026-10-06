// One-off Xero authorisation for THIS app's own Xero app registration.
//
//   node scripts/xero-auth.mjs
//
// projects-pwa holds its own token set, under XERO_PROJECTS_* keys in System config, so
// that it and expense-pwa never refresh each other's tokens — Xero refresh tokens are
// single-use, and two apps sharing one set would take turns invalidating it.
//
// Unlike the expense app's script, the tokens are written straight to System config and
// never printed: a token in terminal scrollback is a token in a log somewhere.
//
// The redirect URI must be registered on the Xero app exactly as printed below. Port 3000
// is the default because that is what was registered; set XERO_AUTH_PORT to use another,
// and add the matching URI to the Xero app first.

import { createServer } from 'http';
import { randomBytes } from 'crypto';
import { google } from 'googleapis';

// Run standalone, so Next.js isn't here to load .env.local for us.
try {
  process.loadEnvFile('.env.local');
} catch {}

const CLIENT_ID     = process.env.XERO_CLIENT_ID;
const CLIENT_SECRET = process.env.XERO_CLIENT_SECRET;
const TENANT_ID     = process.env.XERO_TENANT_ID;
const PORT          = parseInt(process.env.XERO_AUTH_PORT || '3000', 10);
const REDIRECT_URI  = `http://localhost:${PORT}/api/xero/callback`;

// Contacts and settings are read-only on purpose. This app must never create a Xero
// contact — an invoice against a new, name-matched contact lands on the wrong statement —
// and a scope that cannot write is a stronger guarantee than code that promises not to.
const SCOPES = [
  'offline_access',
  'accounting.invoices',
  'accounting.attachments',
  'accounting.contacts.read',
  'accounting.settings.read',
].join(' ');

const CONFIG_TAB = 'System config';
const KEYS = {
  access:  'XERO_PROJECTS_ACCESS_TOKEN',
  refresh: 'XERO_PROJECTS_REFRESH_TOKEN',
  expiry:  'XERO_PROJECTS_TOKEN_EXPIRY',
};

if (!CLIENT_ID || !CLIENT_SECRET || !TENANT_ID) {
  console.error('Set XERO_CLIENT_ID, XERO_CLIENT_SECRET and XERO_TENANT_ID in .env.local first.');
  process.exit(1);
}

function sheetsClient() {
  let key = (process.env.GOOGLE_PRIVATE_KEY || '').trim();
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1);
  }
  const auth = new google.auth.GoogleAuth({
    credentials: { client_email: process.env.GOOGLE_CLIENT_EMAIL, private_key: key.replace(/\\n/g, '\n') },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

/** Write each key's value to System config, updating its row if present and appending if not. */
async function saveTokens(values) {
  const sheets = sheetsClient();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${CONFIG_TAB}'!A:A` });
  const rows = res.data.values || [];

  const outcome = [];
  for (const [key, value] of Object.entries(values)) {
    const index = rows.findIndex(r => String(r[0] ?? '').trim() === key);
    if (index !== -1) {
      // RAW, as the expense app does: a token must never be parsed as a formula or number
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${CONFIG_TAB}'!B${index + 1}`,
        valueInputOption: 'RAW',
        requestBody: { values: [[value]] },
      });
      outcome.push(`${key} updated (row ${index + 1})`);
    } else {
      const appended = await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `'${CONFIG_TAB}'!A:B`,
        valueInputOption: 'RAW',
        requestBody: { values: [[key, value]] },
      });
      outcome.push(`${key} added (${appended.data.updates?.updatedRange})`);
    }
  }
  return outcome;
}

const state = randomBytes(16).toString('hex');
const authUrl = 'https://login.xero.com/identity/connect/authorize?' + new URLSearchParams({
  response_type: 'code',
  client_id:     CLIENT_ID,
  redirect_uri:  REDIRECT_URI,
  scope:         SCOPES,
  state,
});

function finish(res, code, message) {
  res.end(message);
  console.log(`\n${message}\n`);
  server.close();
  process.exit(code);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT_URI);
  if (url.pathname !== '/api/xero/callback') {
    res.end('Not found');
    return;
  }

  try {
    const error = url.searchParams.get('error');
    if (error) return finish(res, 1, `Xero refused the authorisation: ${error}`);
    if (url.searchParams.get('state') !== state) return finish(res, 1, 'State mismatch — start again.');

    const code = url.searchParams.get('code');
    if (!code) return finish(res, 1, 'No code in the callback.');

    const tokenRes = await fetch('https://identity.xero.com/connect/token', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64'),
      },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI }),
    });
    const tokens = await tokenRes.json();
    if (!tokens.access_token || !tokens.refresh_token) {
      return finish(res, 1, `Token exchange failed: ${tokens.error || tokenRes.status}`);
    }

    // Refuse to store tokens for the wrong organisation — every later call sends
    // XERO_TENANT_ID, and a token that cannot see that tenant fails on first use instead.
    const connectionsRes = await fetch('https://api.xero.com/connections', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const connections = await connectionsRes.json();
    const match = Array.isArray(connections) && connections.find(c => c.tenantId === TENANT_ID);
    if (!match) {
      const seen = Array.isArray(connections) ? connections.map(c => c.tenantName).join(', ') : 'none';
      return finish(res, 1, `Authorised, but not for the organisation in XERO_TENANT_ID. Connected: ${seen || 'none'}. Nothing was saved.`);
    }

    const saved = await saveTokens({
      [KEYS.access]:  tokens.access_token,
      [KEYS.refresh]: tokens.refresh_token,
      // 29 minutes, matching the expense app: a minute inside Xero's 30-minute lifetime
      [KEYS.expiry]:  String(Date.now() + 29 * 60 * 1000),
    });

    console.log(`\nConnected to: ${match.tenantName}`);
    console.log(`Scopes granted: ${tokens.scope}`);
    saved.forEach(line => console.log(`  ${line}`));
    finish(res, 0, 'Success. Tokens saved to System config. You can close this tab.');
  } catch (err) {
    finish(res, 1, `Failed: ${err.message}`);
  }
});

server.on('error', err => {
  console.error(err.code === 'EADDRINUSE'
    ? `Port ${PORT} is in use. Stop whatever is running there, or set XERO_AUTH_PORT and register that redirect URI on the Xero app.`
    : err.message);
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`Redirect URI (must be registered on the Xero app): ${REDIRECT_URI}`);
  console.log('\nOpen this URL in your browser:\n');
  console.log(authUrl);
  console.log('\nWaiting for callback...');
});
