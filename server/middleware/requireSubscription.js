const { firebaseConfigured, verifyRequest, isAnonymous } = require('../services/firebaseAdmin');
const { billingConfigured, accessForUser } = require('../services/stripeBilling');
const { useFreeSearch, isNearPreviousSearch } = require('../services/freeSearches');

/**
 * Who is calling and whether they have unlimited research.
 * Every visitor carries a Firebase login, anonymous or real. Requests without
 * one are refused once the server can check logins.
 */
async function resolveAccess(req) {
  if (!firebaseConfigured()) return { open: true };

  const decoded = await verifyRequest(req);
  if (!decoded) {
    throw Object.assign(new Error('Sign-in token required'), { status: 401, code: 'auth_required' });
  }

  const anonymous = isAnonymous(decoded);
  if (anonymous) return { decoded, anonymous, unlimited: false };
  if (!billingConfigured()) return { decoded, anonymous, unlimited: true };

  const access = await accessForUser(decoded);
  return { decoded, anonymous, unlimited: access.active };
}

function sendAccessError(res, err) {
  if (err.status === 401) {
    return res.status(401).json({ error: 'Your session expired. Refresh the page and try again.', code: err.code || 'auth_required' });
  }
  if (err.status === 503) {
    return res.status(503).json({ error: 'Sign-in checks are not available right now.' });
  }
  console.error('[access] check failed:', err.message);
  return res.status(502).json({ error: 'Could not check your account. Try again in a minute.' });
}

function limitResponse(res, anonymous) {
  return res.status(402).json(
    anonymous
      ? { error: 'You have used your free searches.', code: 'free_limit' }
      : { error: 'A SiteScope subscription is required.', code: 'subscription_required' }
  );
}

function pointFrom(query) {
  const lat = parseFloat(query.lat);
  const lng = parseFloat(query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/**
 * Parcel lookups spend a free search on a new location. Flood, soils, wetlands,
 * and topography are only served near a location this visitor already searched.
 */
function requireResearch(kind) {
  return async (req, res, next) => {
    let ctx;
    try {
      ctx = await resolveAccess(req);
    } catch (err) {
      return sendAccessError(res, err);
    }
    if (ctx.open || ctx.unlimited) return next();

    const point = pointFrom(req.query);
    if (!point) return res.status(400).json({ error: 'lat and lng are required' });

    try {
      if (kind === 'layer') {
        if (await isNearPreviousSearch(ctx.decoded.uid, point)) return next();
        return limitResponse(res, ctx.anonymous);
      }

      const ip = ctx.anonymous ? req.ip : null;
      const usage = await useFreeSearch(ctx.decoded.uid, point, ip);
      if (!usage.allowed) return limitResponse(res, ctx.anonymous);

      const json = res.json.bind(res);
      res.json = body => json(
        body && typeof body === 'object' && !Array.isArray(body)
          ? { ...body, freeRemaining: usage.remaining }
          : body
      );
      return next();
    } catch (err) {
      return sendAccessError(res, err);
    }
  };
}

/** DXF export needs a real account, and a subscription once billing is on. */
async function requireExport(req, res, next) {
  let ctx;
  try {
    ctx = await resolveAccess(req);
  } catch (err) {
    return sendAccessError(res, err);
  }
  if (ctx.open) return next();
  if (ctx.anonymous) {
    return res.status(401).json({ error: 'Sign in to export.', code: 'account_required' });
  }
  if (!ctx.unlimited) return limitResponse(res, false);
  return next();
}

module.exports = { requireResearch, requireExport };
