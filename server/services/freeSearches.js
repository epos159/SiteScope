const crypto = require('crypto');
const { FieldValue } = require('firebase-admin/firestore');
const { firestore } = require('./firebaseAdmin');

const FREE_LIMIT = 5;
// Clicking around the neighborhood of a search (the parcel, its neighbors, the
// lot across the road) is part of that search, not a new one.
const NEARBY_KM = 2;
// Clearing the browser starts a new anonymous visitor. This caps how many free
// searches one network can pull per day that way.
const DAILY_IP_LIMIT = 30;
const CACHE_MS = 5 * 60_000;

/** uid -> { anchors: [{ lat, lng, at }], at } */
const cache = new Map();

function distanceKm(a, b) {
  const rad = d => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

function isNear(anchors, point) {
  return anchors.some(anchor => distanceKm(anchor, point) <= NEARBY_KM);
}

function remainingFor(anchors) {
  return Math.max(0, FREE_LIMIT - anchors.length);
}

function ipKey(ip) {
  return crypto.createHash('sha256').update(`sitescope-free:${ip}`).digest('hex').slice(0, 32);
}

async function loadAnchors(uid) {
  const hit = cache.get(uid);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.anchors;
  const snap = await firestore().collection('freeSearches').doc(uid).get();
  const anchors = snap.exists ? snap.data().anchors || [] : [];
  cache.set(uid, { anchors, at: Date.now() });
  return anchors;
}

async function freeRemaining(uid) {
  return remainingFor(await loadAnchors(uid));
}

/** Flood, soils, wetlands, and topography only for places this visitor already searched. */
async function isNearPreviousSearch(uid, point) {
  return isNear(await loadAnchors(uid), point);
}

/**
 * Spend a free search on a new location, or allow a repeat look near an old one.
 * Returns { allowed, remaining }.
 */
async function useFreeSearch(uid, point, ip) {
  const cached = await loadAnchors(uid);
  if (isNear(cached, point)) return { allowed: true, remaining: remainingFor(cached) };
  if (cached.length >= FREE_LIMIT) return { allowed: false, remaining: 0 };

  const db = firestore();
  const userRef = db.collection('freeSearches').doc(uid);
  const day = new Date().toISOString().slice(0, 10);
  const ipRef = ip ? db.collection('freeSearchIps').doc(`${ipKey(ip)}_${day}`) : null;

  const result = await db.runTransaction(async tx => {
    const userSnap = await tx.get(userRef);
    const ipSnap = ipRef ? await tx.get(ipRef) : null;
    const anchors = userSnap.exists ? userSnap.data().anchors || [] : [];

    if (isNear(anchors, point)) return { allowed: true, anchors };
    if (anchors.length >= FREE_LIMIT) return { allowed: false, anchors };

    const ipCount = ipSnap?.exists ? ipSnap.data().count || 0 : 0;
    if (ipRef && ipCount >= DAILY_IP_LIMIT) return { allowed: false, anchors };

    const next = [...anchors, { lat: point.lat, lng: point.lng, at: Date.now() }];
    tx.set(userRef, { anchors: next, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    if (ipRef) tx.set(ipRef, { count: ipCount + 1, day }, { merge: true });
    return { allowed: true, anchors: next };
  });

  cache.set(uid, { anchors: result.anchors, at: Date.now() });
  return { allowed: result.allowed, remaining: remainingFor(result.anchors) };
}

module.exports = { FREE_LIMIT, freeRemaining, isNearPreviousSearch, useFreeSearch };
