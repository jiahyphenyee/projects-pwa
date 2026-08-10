import { google } from 'googleapis';

/**
 * Normalise the service account key.
 *
 * The same value is stored two ways depending on environment, and only one of them is
 * cleaned up for us:
 *   - .env.local — dotenv strips the surrounding quotes before the app sees it
 *   - Vercel env vars — stored verbatim, quotes and all
 *
 * So a key pasted into Vercel with its quotes still attached arrives as `"-----BEGIN…"`
 * and fails to parse, producing a 500 that says nothing useful. Strip them here and
 * accept either form, plus real newlines for anyone who pasted the multi-line PEM.
 */
function normalisePrivateKey(raw) {
  if (!raw) return undefined;
  let key = raw.trim();

  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1);
  }
  return key.replace(/\\n/g, '\n');
}

export function getGoogleAuth() {
  const privateKey = normalisePrivateKey(process.env.GOOGLE_PRIVATE_KEY);

  // Fail loudly and specifically — the default error is an opaque DECODER routines crash
  if (!privateKey?.includes('BEGIN PRIVATE KEY')) {
    throw new Error(
      'GOOGLE_PRIVATE_KEY is missing or malformed — it must contain the full PEM ' +
      'including the BEGIN/END lines.'
    );
  }
  if (!process.env.GOOGLE_CLIENT_EMAIL) {
    throw new Error('GOOGLE_CLIENT_EMAIL is not set');
  }

  return new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key:  privateKey,
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

// Cached across warm invocations — building the client per request is wasteful.
let clientPromise = null;

export async function getSheetsClient() {
  if (!clientPromise) {
    clientPromise = getGoogleAuth()
      .getClient()
      .then(auth => google.sheets({ version: 'v4', auth }))
      .catch(err => { clientPromise = null; throw err; });
  }
  return clientPromise;
}

export function getSheetId() {
  const id = process.env.GOOGLE_SHEET_ID;
  if (!id) throw new Error('GOOGLE_SHEET_ID is not set');
  return id;
}
