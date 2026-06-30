import React, { useState } from 'react';
import './MapView.css';

const LAYER_CONFIG = [
  {
    id: 'aerial',
    label: 'Aerial Imagery',
    color: '#64748b',
    defaultOn: true,
    description: 'Esri satellite basemap',
  },
  {
    id: 'parcel',
    label: 'Parcel Boundary',
    color: '#f59e0b',
    defaultOn: true,
    description: 'County GIS parcel',
  },
  {
    id: 'flood',
    label: 'FEMA Flood Zones',
    color: '#3b82f6',
    defaultOn: false,
    description: 'National Flood Hazard Layer',
  },
  {
    id: 'soil',
    label: 'Soil Types',
    color: '#a16207',
    defaultOn: false,
    description: 'NRCS SSURGO',
  },
  {
    id: 'contours',
    label: 'Topographic Contours',
    color: '#78350f',
    defaultOn: false,
    description: 'USGS 3DEP',
  },
  {
    id: 'wetlands',
    label: 'Wetlands',
    color: '#10b981',
    defaultOn: false,
    description: 'National Wetlands Inventory',
  },
  {
    id: 'slopes',
    label: 'Terrain / Steep Slopes',
    color: '#dc2626',
    defaultOn: false,
    description: 'USGS elevation hillshade',
  },
];

export default function LayerControl({ layers, onToggle }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className={`layer-control ${collapsed ? 'layer-control--collapsed' : ''}`}>
      <button
        className="layer-control-header"
        onClick={() => setCollapsed(c => !c)}
        aria-expanded={!collapsed}
        aria-label="Toggle layers panel"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polygon points="12 2 2 7 12 12 22 7 12 2" />
          <polyline points="2 17 12 22 22 17" />
          <polyline points="2 12 12 17 22 12" />
        </svg>
        <span>Layers</span>
        <span className="layer-control-chevron">{collapsed ? '▲' : '▼'}</span>
      </button>

      {!collapsed && (
        <ul className="layer-control-list">
          {LAYER_CONFIG.map(layer => (
            <li key={layer.id} className="layer-control-item">
              <label className="layer-control-label">
                <input
                  type="checkbox"
                  className="layer-control-checkbox"
                  checked={layers[layer.id] ?? false}
                  onChange={() => onToggle(layer.id)}
                />
                <span
                  className="layer-control-swatch"
                  style={{ background: layer.color }}
                  aria-hidden="true"
                />
                <span className="layer-control-text">
                  <span className="layer-control-name">{layer.label}</span>
                  <span className="layer-control-desc">{layer.description}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
