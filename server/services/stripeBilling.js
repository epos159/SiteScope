const Stripe = require('stripe');
const { firebaseConfigured } = require('./firebaseAdmin');

const ACTIVE_STATUSES = new Set(['active', 'trialing']);
const CACHE_MS = 60_000;

/** uid -> { active, comped, customerId, at } */
const accessCache = new Map();

let stripeClient = null;

function stripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  if (!stripeClient) stripeClient = new Stripe(key);
  return stripeClient;
}

/** Billing stays off until Stripe, the price, and Firebase Admin are all configured. */
function billingConfigured() {
  return Boolean(stripe() && process.env.STRIPE_PRICE_ID && firebaseConfigured());
}

function compedEmails() {
  return new Set(
    String(process.env.COMPED_EMAILS || '')
      .split(',')
      .map(email => email.trim().toLowerCase())
      .filter(Boolean)
  );
}

function publicOrigin() {
  const raw = (process.env.CLIENT_ORIGIN || 'https://sitescope.poschventures.com').split(',')[0].trim();
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withProtocol.replace(/\/$/, '');
}

function remember(uid, active, customerId) {
  const row = { active: Boolean(active), comped: false, customerId: customerId || null, at: Date.now() };
  accessCache.set(uid, row);
  return row;
}

async function findCustomer(uid) {
  const client = stripe();
  const cached = accessCache.get(uid);
  if (cached?.customerId) {
    try {
      const customer = await client.customers.retrieve(cached.customerId);
      if (!customer.deleted) return customer;
    } catch {
      // Customer id was stale. Look it up again.
    }
  }
  const safeUid = String(uid).replace(/'/g, '');
  const result = await client.customers.search({
    query: `metadata['firebaseUid']:'${safeUid}'`,
    limit: 1,
  });
  return result.data[0] || null;
}

async function subscriptionActive(customerId) {
  const subs = await stripe().subscriptions.list({ customer: customerId, status: 'all', limit: 20 });
  return subs.data.some(sub => ACTIVE_STATUSES.has(sub.status));
}

async function syncCustomer(customerId) {
  const customer = await stripe().customers.retrieve(customerId);
  if (!customer || customer.deleted) return null;
  const uid = customer.metadata?.firebaseUid;
  if (!uid) return null;
  const active = await subscriptionActive(customerId);
  return remember(uid, active, customerId);
}

/**
 * Whether this signed-in user may load paid research.
 * Comped addresses and active subscriptions pass. A comped address only counts
 * once its owner has verified it, so nobody can register it first.
 */
async function accessForUser(decoded) {
  const email = String(decoded.email || '').toLowerCase();
  if (email && decoded.email_verified === true && compedEmails().has(email)) {
    return { active: true, comped: true, customerId: null };
  }
  const hit = accessCache.get(decoded.uid);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit;

  const customer = await findCustomer(decoded.uid);
  if (!customer) return remember(decoded.uid, false, null);
  const active = await subscriptionActive(customer.id);
  return remember(decoded.uid, active, customer.id);
}

async function createCheckoutSession(decoded) {
  const client = stripe();
  let customer = await findCustomer(decoded.uid);
  if (!customer) {
    customer = await client.customers.create({
      email: decoded.email || undefined,
      metadata: { firebaseUid: decoded.uid },
    });
    remember(decoded.uid, false, customer.id);
  }

  const origin = publicOrigin();
  const automaticTax = process.env.STRIPE_AUTOMATIC_TAX === 'true';
  const session = await client.checkout.sessions.create({
    mode: 'subscription',
    customer: customer.id,
    client_reference_id: decoded.uid,
    line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
    success_url: `${origin}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/?checkout=cancel`,
    billing_address_collection: 'required',
    customer_update: { address: 'auto' },
    metadata: { firebaseUid: decoded.uid },
    subscription_data: { metadata: { firebaseUid: decoded.uid } },
    ...(automaticTax ? { automatic_tax: { enabled: true } } : {}),
  });
  return session.url;
}

async function createPortalSession(decoded) {
  const customer = await findCustomer(decoded.uid);
  if (!customer) {
    const err = new Error('No Stripe customer for this account yet');
    err.status = 404;
    throw err;
  }
  const session = await stripe().billingPortal.sessions.create({
    customer: customer.id,
    return_url: publicOrigin(),
  });
  return session.url;
}

/**
 * Confirm a Checkout return without waiting for the webhook.
 * The session must belong to this Firebase user.
 */
async function accessFromCheckoutSession(decoded, sessionId) {
  if (!sessionId) return accessForUser(decoded);
  const session = await stripe().checkout.sessions.retrieve(sessionId);
  if (session.client_reference_id !== decoded.uid) return accessForUser(decoded);
  if (session.customer) {
    await stripe().customers.update(session.customer, {
      metadata: { firebaseUid: decoded.uid },
    });
    const synced = await syncCustomer(session.customer);
    if (synced) return synced;
  }
  return accessForUser(decoded);
}

async function handleWebhook(req, res) {
  const client = stripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!client || !secret) {
    res.status(503).json({ error: 'Stripe webhook is not configured' });
    return;
  }

  let event;
  try {
    event = client.webhooks.constructEvent(req.body, req.get('stripe-signature'), secret);
  } catch (err) {
    res.status(400).json({ error: `Webhook signature failed: ${err.message}` });
    return;
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const uid = session.client_reference_id || session.metadata?.firebaseUid;
    if (uid && session.customer) {
      await client.customers.update(session.customer, { metadata: { firebaseUid: uid } });
      await syncCustomer(session.customer);
    }
  } else if (event.data?.object?.customer) {
    await syncCustomer(event.data.object.customer);
  }

  res.json({ received: true });
}

module.exports = {
  billingConfigured,
  accessForUser,
  accessFromCheckoutSession,
  createCheckoutSession,
  createPortalSession,
  handleWebhook,
};
