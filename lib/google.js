import { google } from 'googleapis';

export function getGoogleAuth() {
  return new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key:  process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
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
