require('dotenv').config();
const express = require('express');
const cors = require('cors');

const geocodeRouter = require('./routes/geocode');
const parcelsRouter = require('./routes/parcels');
const floodRouter = require('./routes/flood');
const soilRouter = require('./routes/soil');
const buildingsRouter = require('./routes/buildings');
const elevationRouter = require('./routes/elevation');
const wetlandsRouter = require('./routes/wetlands');

const app = express();

app.use(cors({ origin: process.env.CLIENT_ORIGIN || '*' }));
app.use(express.json());

app.use('/api/geocode', geocodeRouter);
app.use('/api/parcels', parcelsRouter);
app.use('/api/flood', floodRouter);
app.use('/api/soil', soilRouter);
app.use('/api/buildings', buildingsRouter);
app.use('/api/elevation', elevationRouter);
app.use('/api/wetlands', wetlandsRouter);

app.get('/health', (_req, res) => res.json({ status: 'ok', app: 'SiteScope' }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`SiteScope server running on http://localhost:${PORT}`);
});
