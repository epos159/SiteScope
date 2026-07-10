require('dotenv').config();
const express = require('express');
const cors = require('cors');

const geocodeRouter = require('./routes/geocode');
const addressSuggestRouter = require('./routes/addressSuggest');
const parcelsRouter = require('./routes/parcels');
const floodRouter = require('./routes/flood');
const soilRouter = require('./routes/soil');
const elevationRouter = require('./routes/elevation');
const wetlandsRouter = require('./routes/wetlands');

const app = express();

/**
 * CLIENT_ORIGIN may be set with or without https:// in the Render dashboard.
 * Browsers always send a full origin (https://...), so a bare hostname fails CORS
 * and every search looks like "Address not found" in the UI.
 */
function resolveCorsOrigin() {
  const raw = (process.env.CLIENT_ORIGIN || '').trim();
  if (!raw || raw === '*') return true; // reflect request Origin
  return raw.split(',').map(part => {
    const origin = part.trim();
    if (!origin) return origin;
    if (/^https?:\/\//i.test(origin)) return origin;
    return `https://${origin}`;
  });
}

app.use(cors({ origin: resolveCorsOrigin() }));
app.use(express.json());

app.use('/api/geocode', geocodeRouter);
app.use('/api/address-suggest', addressSuggestRouter);
app.use('/api/parcels', parcelsRouter);
app.use('/api/flood', floodRouter);
app.use('/api/soil', soilRouter);
app.use('/api/elevation', elevationRouter);
app.use('/api/wetlands', wetlandsRouter);

app.get('/health', (_req, res) => res.json({ status: 'ok', app: 'SiteScope' }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`SiteScope server running on http://localhost:${PORT}`);
});
