const express = require('express');
const { firebaseConfigured, verifyRequest, isAnonymous } = require('../services/firebaseAdmin');
const {
  billingConfigured,
  accessForUser,
  accessFromCheckoutSession,
  createCheckoutSession,
  createPortalSession,
} = require('../services/stripeBilling');
const { FREE_LIMIT, freeRemaining } = require('../services/freeSearches');

const router = express.Router();

async function verified(req, res) {
  try {
    const decoded = await verifyRequest(req);
    if (!decoded) {
      res.status(401).json({ error: 'Sign in to continue.' });
      return null;
    }
    return decoded;
  } catch (err) {
    res.status(err.status || 401).json({ error: 'Your session expired. Refresh the page and try again.' });
    return null;
  }
}

/** A real (not anonymous) account, for Checkout and the billing portal. */
async function signedIn(req, res) {
  if (!billingConfigured()) {
    res.status(503).json({ error: 'Billing is not configured yet.' });
    return null;
  }
  const decoded = await verified(req, res);
  if (!decoded) return null;
  if (isAnonymous(decoded)) {
    res.status(401).json({ error: 'Sign in to subscribe.' });
    return null;
  }
  return decoded;
}

/**
 * { configured, enforced, active, freeRemaining, freeLimit }
 * `configured` is Stripe billing. `enforced` means the server counts free searches.
 */
router.get('/status', async (req, res) => {
  if (!firebaseConfigured()) {
    return res.json({ configured: false, enforced: false, active: false });
  }
  const decoded = await verified(req, res);
  if (!decoded) return undefined;

  try {
    const configured = billingConfigured();
    let active = false;
    let comped = false;
    if (!isAnonymous(decoded)) {
      if (!configured) {
        active = true;
      } else {
        const access = req.query.session_id
          ? await accessFromCheckoutSession(decoded, String(req.query.session_id))
          : await accessForUser(decoded);
        active = access.active;
        comped = Boolean(access.comped);
      }
    }
    return res.json({
      configured,
      enforced: true,
      active,
      comped,
      freeLimit: FREE_LIMIT,
      freeRemaining: active ? null : await freeRemaining(decoded.uid),
    });
  } catch (err) {
    console.error('[billing] status failed:', err.message);
    return res.status(502).json({ error: 'Could not check the subscription.' });
  }
});

router.post('/checkout', async (req, res) => {
  const decoded = await signedIn(req, res);
  if (!decoded) return undefined;
  try {
    const url = await createCheckoutSession(decoded);
    return res.json({ url });
  } catch (err) {
    console.error('[billing] checkout failed:', err.message);
    return res.status(502).json({ error: 'Could not start checkout.' });
  }
});

router.post('/portal', async (req, res) => {
  const decoded = await signedIn(req, res);
  if (!decoded) return undefined;
  try {
    const url = await createPortalSession(decoded);
    return res.json({ url });
  } catch (err) {
    console.error('[billing] portal failed:', err.message);
    const status = err.status || 502;
    const message = status === 404
      ? 'Subscribe first, then you can manage billing.'
      : 'Could not open billing. Turn on the Customer Portal in Stripe, then try again.';
    return res.status(status).json({ error: message });
  }
});

module.exports = router;
