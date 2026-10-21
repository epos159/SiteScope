require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { rateLimit } = require('express-rate-limit');

const geocodeRouter = require('./routes/geocode');
const addressSuggestRouter = require('./routes/addressSuggest');
const parcelsRouter = require('./routes/parcels');
const floodRouter = require('./routes/flood');
const soilRouter = require('./routes/soil');
const elevationRouter = require('./routes/elevation');
const wetlandsRouter = require('./routes/wetlands');
const exportDxfRouter = require('./routes/exportDxf');
const billingRouter = require('./routes/billing');
const { handleWebhook } = require('./services/stripeBilling');
const { firebaseConfigured } = require('./services/firebaseAdmin');
const { requireResearch, requireExport } = require('./middleware/requireSubscription');

const PRODUCTION_ORIGIN = 'https://sitescope.poschventures.com';
const onRender = process.env.RENDER === 'true';

const app = express();

// Render sits one proxy in front of the app. The rate limits and the per-network
// free-search cap need the visitor's address, not the proxy's.
if (onRender) app.set('trust proxy', 1);

/**
 * CLIENT_ORIGIN may be set with or without https:// in the Render dashboard.
 * Browsers always send a full origin (https://...), so a bare hostname fails CORS
 * and every search looks like "Address not found" in the UI.
 * On Render, a blank or "*" value falls back to the production site instead of
 * letting every website call the API.
 */
function resolveCorsOrigin() {
  const raw = (process.env.CLIENT_ORIGIN || '').trim();
  if (!raw || raw === '*') {
    if (onRender) {
      console.warn(`[cors] CLIENT_ORIGIN is not set. Allowing only ${PRODUCTION_ORIGIN}.`);
      return [PRODUCTION_ORIGIN];
    }
    return true; // local development: reflect request Origin
  }
  return raw.split(',').map(part => {
    const origin = part.trim();
    if (!origin) return origin;
    if (/^https?:\/\//i.test(origin)) return origin;
    return `https://${origin}`;
  });
}

function limiter(perMinute) {
  return rateLimit({
    windowMs: 60_000,
    limit: perMinute,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many requests. Wait a minute and try again.' },
  });
}

app.use(cors({ origin: resolveCorsOrigin() }));

// Stripe signs the raw body. This route must be registered before express.json().
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  handleWebhook(req, res).catch(err => {
    console.error('[billing] webhook failed:', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Webhook failed' });
  });
});

app.use(express.json());

// A search is a parcel lookup plus four layers, and typing fires suggestions.
// These limits leave room for fast clicking without letting a script loop.
const researchLimit = limiter(150);

app.use('/api/geocode', limiter(40), geocodeRouter);
app.use('/api/address-suggest', limiter(120), addressSuggestRouter);
app.use('/api/billing', limiter(30), billingRouter);
app.use('/api/parcels', researchLimit, requireResearch('parcel'), parcelsRouter);
app.use('/api/flood', researchLimit, requireResearch('layer'), floodRouter);
app.use('/api/soil', researchLimit, requireResearch('layer'), soilRouter);
app.use('/api/elevation', researchLimit, requireResearch('layer'), elevationRouter);
app.use('/api/wetlands', researchLimit, requireResearch('layer'), wetlandsRouter);
app.use('/api/export', limiter(10), requireExport, exportDxfRouter);

app.get('/health', (_req, res) => res.json({ status: 'ok', app: 'SiteScope' }));

if (!firebaseConfigured()) {
  console.warn('[access] FIREBASE_SERVICE_ACCOUNT is not set. Free searches are not counted on the server.');
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`SiteScope server running on http://localhost:${PORT}`);
});
