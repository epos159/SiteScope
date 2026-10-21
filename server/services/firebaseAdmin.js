const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');

let ready = false;

/** Server-side login checks stay off until the service account is configured. */
function firebaseConfigured() {
  if (ready) return true;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return false;
  try {
    if (!getApps().length) initializeApp({ credential: cert(JSON.parse(raw)) });
    ready = true;
    return true;
  } catch (err) {
    console.error('[firebase] FIREBASE_SERVICE_ACCOUNT is invalid:', err.message);
    return false;
  }
}

/**
 * Decoded Firebase ID token from `Authorization: Bearer <token>`, or null when
 * no header was sent. A malformed header or a bad token throws a 401.
 */
async function verifyRequest(req) {
  const header = req.get('authorization');
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  const unauthorized = () => Object.assign(new Error('Invalid sign-in token'), { status: 401 });
  if (!match) throw unauthorized();
  if (!firebaseConfigured()) {
    throw Object.assign(new Error('Firebase Admin is not configured'), { status: 503 });
  }
  try {
    return await getAuth().verifyIdToken(match[1]);
  } catch {
    throw unauthorized();
  }
}

function isAnonymous(decoded) {
  return decoded?.firebase?.sign_in_provider === 'anonymous';
}

function firestore() {
  return getFirestore();
}

module.exports = { firebaseConfigured, verifyRequest, isAnonymous, firestore };
