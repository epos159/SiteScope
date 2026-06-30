import React, { useState, useEffect, useRef } from 'react';
import {
  MapContainer,
  TileLayer,
  GeoJSON,
  WMSTileLayer,
  useMap,
} from 'react-leaflet';
import L from 'leaflet';
import LayerControl from './LayerControl';
import './MapView.css';

// Fix Leaflet default icon path broken by bundlers
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const DEFAULT_CENTER = [39.96, -76.73]; // York, PA
const DEFAULT_ZOOM = 10;

// ── Layer style helpers ────────────────────────────────────────────
const PARCEL_STYLE = {
  color: '#f59e0b',
  weight: 3,
  fillColor: '#fbbf24',
  fillOpacity: 0.12,
};

const FLOOD_ZONE_COLORS = {
  AE: '#3b82f6', VE: '#1e40af', A: '#60a5fa', AH: '#7dd3fc',
  AO: '#93c5fd', A99: '#bfdbfe', AR: '#818cf8', X: '#dbeafe', D: '#e5e7eb',
};

const floodStyle = feature => {
  const zone = feature?.properties?.FLD_ZONE || 'X';
  return {
    color: FLOOD_ZONE_COLORS[zone] || '#94a3b8',
    weight: 1,
    fillColor: FLOOD_ZONE_COLORS[zone] || '#94a3b8',
    fillOpacity: 0.35,
  };
};

const WETLAND_COLORS = {
  'Freshwater Emergent Wetland': '#10b981',
  'Freshwater Forested/Shrub Wetland': '#065f46',
  'Estuarine and Marine Wetland': '#0d9488',
  'Riverine': '#2563eb',
  'Lake': '#3b82f6',
};

const wetlandStyle = feature => {
  const type = feature?.properties?.WETLAND_TYPE || '';
  const color = WETLAND_COLORS[type] || '#14b8a6';
  return { color, weight: 1, fillColor: color, fillOpacity: 0.45 };
};

// ── Map fly-to controller ──────────────────────────────────────────
function MapController({ parcelFeature, location }) {
  const map = useMap();
  const prevLocationRef = useRef(null);

  useEffect(() => {
    if (parcelFeature?.geometry) {
      try {
        const layer = L.geoJSON(parcelFeature);
        const bounds = layer.getBounds();
        if (bounds.isValid()) {
          map.flyToBounds(bounds, { padding: [60, 60], duration: 0.8 });
        }
      } catch {
        // Silently ignore invalid geometry
      }
    } else if (location && location !== prevLocationRef.current) {
      prevLocationRef.current = location;
      map.flyTo([location.lat, location.lng], 15, { duration: 0.8 });
    }
  }, [parcelFeature, location, map]);

  return null;
}

const NEIGHBOR_STYLE = {
  color: '#f59e0b',
  weight: 1.5,
  fillColor: '#fcd34d',
  fillOpacity: 0.08,
  dashArray: '4 4',
};

const NEIGHBOR_HOVER_STYLE = {
  color: '#d97706',
  weight: 2.5,
  fillColor: '#fcd34d',
  fillOpacity: 0.25,
  dashArray: null,
};

function MapClickHandler({ onParcelClick, enabled }) {
  const map = useMap();

  useEffect(() => {
    if (!enabled || !onParcelClick) return undefined;

    const handleClick = e => {
      onParcelClick(e.latlng.lat, e.latlng.lng);
    };

    map.on('click', handleClick);
    return () => map.off('click', handleClick);
  }, [map, onParcelClick, enabled]);

  return null;
}

function NeighborLayer({ neighbors, onNeighborClick }) {
  if (!neighbors?.length) return null;

  return neighbors.map(n => {
    if (!n.geometry) return null;
    const geoJSON = { type: 'Feature', geometry: n.geometry, properties: n };

    return (
      <GeoJSON
        key={n.parcelId || `${n.centroid?.lat}${n.centroid?.lng}`}
        data={geoJSON}
        style={NEIGHBOR_STYLE}
        onEachFeature={(feature, layer) => {
          layer.on('mouseover', () => layer.setStyle(NEIGHBOR_HOVER_STYLE));
          layer.on('mouseout', () => layer.setStyle(NEIGHBOR_STYLE));
          layer.on('click', e => {
            L.DomEvent.stopPropagation(e);
            const { centroid, ownerName } = feature.properties;
            if (centroid) onNeighborClick(centroid.lat, centroid.lng, ownerName);
          });
          if (n.ownerName) {
            layer.bindTooltip(n.ownerName, { sticky: true, className: 'neighbor-tooltip' });
          }
        }}
      />
    );
  });
}

// ── Main MapView component ─────────────────────────────────────────
export default function MapView({
  location,
  parcelFeature,
  neighborFeatures,
  floodFeatures,
  wetlandFeatures,
  status,
  onNeighborClick,
  onParcelClick,
}) {
  const [layers, setLayers] = useState({
    aerial: true,
    parcel: true,
    flood: false,
    soil: false,
    contours: false,
    wetlands: false,
    slopes: false,
  });

  const toggleLayer = name => {
    setLayers(prev => ({ ...prev, [name]: !prev[name] }));
  };

  const floodGeoJSON = floodFeatures?.length
    ? { type: 'FeatureCollection', features: floodFeatures }
    : null;

  const wetlandGeoJSON = wetlandFeatures?.length
    ? { type: 'FeatureCollection', features: wetlandFeatures }
    : null;

  return (
    <div className="map-wrapper">
      {status === 'loading' && (
        <div className="map-loading-bar">
          <div className="map-loading-bar-inner" />
        </div>
      )}

      <MapContainer
        center={DEFAULT_CENTER}
        zoom={DEFAULT_ZOOM}
        className="map-container"
        zoomControl={false}
      >
        {/* Zoom control top-left */}
        <div className="leaflet-control-zoom leaflet-bar leaflet-control" style={{ position: 'absolute', top: 10, left: 10, zIndex: 1000 }} />

        {/* ── Base layers ── */}
        {layers.aerial ? (
          <TileLayer
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            attribution='Tiles &copy; Esri &mdash; Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
            maxZoom={20}
          />
        ) : (
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
            attribution='&copy; <a href="https://carto.com/">CARTO</a>'
            maxZoom={20}
          />
        )}

        {/* ── Topographic contours WMS ── */}
        {layers.contours && (
          <WMSTileLayer
            url="https://carto.nationalmap.gov/arcgis/services/contours/MapServer/WMSServer"
            layers="0"
            format="image/png"
            transparent
            opacity={0.7}
            attribution="USGS National Map"
          />
        )}

        {/* ── NRCS Soil WMS ── */}
        {layers.soil && (
          <WMSTileLayer
            url="https://SDMDataAccess.sc.egov.usda.gov/Spatial/SDM.wms"
            layers="MapunitPoly"
            format="image/png"
            transparent
            opacity={0.55}
            attribution="USDA NRCS Soil Survey"
          />
        )}

        {/* ── Steep slopes WMS (USGS hillshade) ── */}
        {layers.slopes && (
          <WMSTileLayer
            url="https://elevation.nationalmap.gov/arcgis/services/3DEPElevation/ImageServer/WMSServer"
            layers="3DEPElevation:Hillshade Multidirectional"
            format="image/png"
            transparent
            opacity={0.45}
            attribution="USGS 3DEP Elevation"
          />
        )}

        {/* ── FEMA Flood Zones GeoJSON ── */}
        {layers.flood && floodGeoJSON && (
          <GeoJSON
            key={`flood-${JSON.stringify(floodGeoJSON).length}`}
            data={floodGeoJSON}
            style={floodStyle}
          />
        )}

        {/* ── NWI Wetlands GeoJSON ── */}
        {layers.wetlands && wetlandGeoJSON && (
          <GeoJSON
            key={`wetlands-${wetlandGeoJSON.features.length}`}
            data={wetlandGeoJSON}
            style={wetlandStyle}
          />
        )}

        {/* ── Neighbor parcels (below main parcel boundary) ── */}
        {layers.parcel && onNeighborClick && (
          <NeighborLayer neighbors={neighborFeatures} onNeighborClick={onNeighborClick} />
        )}

        {/* ── Parcel boundary (always on top of data layers) ── */}
        {layers.parcel && parcelFeature && (
          <GeoJSON
            key={`parcel-${parcelFeature.properties?.parcelId || 'unknown'}`}
            data={parcelFeature}
            style={PARCEL_STYLE}
          />
        )}

        {/* Map controller — handles fly-to on new data */}
        <MapController parcelFeature={parcelFeature} location={location} />

        {/* Click any parcel on the map */}
        <MapClickHandler onParcelClick={onParcelClick} enabled={!!onParcelClick} />
      </MapContainer>

      {onParcelClick && status !== 'loading' && (
        <div className="map-click-hint">Click any parcel to load its data</div>
      )}

      {/* Layer control panel */}
      <LayerControl
        layers={layers}
        onToggle={toggleLayer}
        hasParcel={!!parcelFeature}
        hasFlood={!!floodGeoJSON}
        hasWetlands={!!wetlandGeoJSON}
      />
    </div>
  );
}
