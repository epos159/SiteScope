import React, { useState, useRef } from 'react';
import Papa from 'papaparse';
import './ExportPanel.css';

async function captureElement(el) {
  const { default: html2canvas } = await import('html2canvas');
  return html2canvas(el, {
    useCORS: true,
    allowTaint: true,
    scale: 2,
    backgroundColor: '#ffffff',
    logging: false,
  });
}

async function exportPDF({ address, mapRef, dataPanelRef }) {
  const { jsPDF } = await import('jspdf');
  const date = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 36;
  const contentW = pageW - margin * 2;

  // Header
  pdf.setFillColor(26, 41, 64);
  pdf.rect(0, 0, pageW, 52, 'F');
  pdf.setTextColor(255, 255, 255);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(16);
  pdf.text('SiteScope Site Research Report', margin, 24);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.text(`${address}`, margin, 38);
  pdf.text(`Generated ${date}`, margin, 49);

  let y = 68;

  // Map snapshot
  if (mapRef?.current) {
    try {
      const mapEl = mapRef.current.querySelector('.map-container') || mapRef.current;
      const canvas = await captureElement(mapEl);
      const imgData = canvas.toDataURL('image/jpeg', 0.85);
      const mapH = (canvas.height / canvas.width) * contentW;
      pdf.addImage(imgData, 'JPEG', margin, y, contentW, Math.min(mapH, 240));
      y += Math.min(mapH, 240) + 16;
    } catch (e) {
      console.warn('Map capture failed:', e);
    }
  }

  // Data panel snapshot — may require a new page
  if (dataPanelRef?.current) {
    try {
      const canvas = await captureElement(dataPanelRef.current);
      const imgData = canvas.toDataURL('image/jpeg', 0.85);
      const panelW = contentW;
      const panelH = (canvas.height / canvas.width) * panelW;

      if (y + panelH > pageH - 52) {
        pdf.addPage();
        y = 36;
      }

      pdf.addImage(imgData, 'JPEG', margin, y, panelW, panelH);
    } catch (e) {
      console.warn('Data panel capture failed:', e);
    }
  }

  // Footer
  const totalPages = pdf.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    pdf.setPage(i);
    pdf.setFillColor(240, 242, 245);
    pdf.rect(0, pageH - 28, pageW, 28, 'F');
    pdf.setTextColor(100, 116, 139);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.text('SiteScope by Posch Ventures — poschventures.com', margin, pageH - 10);
    pdf.text(`Page ${i} of ${totalPages}`, pageW - margin, pageH - 10, { align: 'right' });
  }

  const safeAddr = address.replace(/[^a-z0-9]/gi, '_').slice(0, 40);
  pdf.save(`SiteScope_${safeAddr}_${date.replace(/\s/g, '-')}.pdf`);
}

async function exportPNG({ mapRef }) {
  if (!mapRef?.current) return;
  try {
    const mapEl = mapRef.current.querySelector('.map-container') || mapRef.current;
    const canvas = await captureElement(mapEl);
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    const date = new Date().toISOString().slice(0, 10);
    a.download = `SiteScope_Map_${date}.png`;
    a.click();
  } catch (e) {
    console.error('PNG export failed:', e);
  }
}

function exportCSV({ location, parcel, flood, soil, elevation, buildings, wetlands }) {
  const rows = [];

  const add = (section, key, value) => {
    if (value != null && value !== '') {
      rows.push({ Section: section, Field: key, Value: String(value) });
    }
  };

  // Location
  add('Location', 'Address', location?.displayName);
  add('Location', 'County', location?.county);
  add('Location', 'State', location?.state);
  add('Location', 'Latitude', location?.lat);
  add('Location', 'Longitude', location?.lng);

  // Parcel
  const p = parcel?.feature?.properties;
  if (p) {
    add('Parcel', 'Owner Name', p.ownerName);
    add('Parcel', 'Owner Name 2', p.ownerName2);
    add('Parcel', 'Parcel ID', p.parcelId);
    add('Parcel', 'Acreage', p.acreage);
    add('Parcel', 'Municipality', p.municipality);
    add('Parcel', 'County', p.county);
    add('Parcel', 'Site Address', p.siteAddress);
  }
  (parcel?.neighbors || []).forEach((n, i) => {
    add('Adjoining Parcels', `Neighbor ${i + 1}`, n.ownerName);
  });

  // Flood
  if (flood && !flood.error) {
    add('Flood', 'Flood Zone', flood.zone);
    add('Flood', 'Zone Description', flood.description);
    add('Flood', 'SFHA', flood.sfha ? 'Yes' : 'No');
    add('Flood', 'FIRM Panel', flood.firmPanel);
    add('Flood', 'Base Flood Elevation', flood.staticBfe);
  }

  // Soil
  (soil?.mapUnits || []).forEach((mu, i) => {
    const prefix = `Soil Unit ${i + 1} (${mu.symbol})`;
    add(prefix, 'Name', mu.name);
    add(prefix, 'Component %', mu.componentPct);
    add(prefix, 'Slope Class', mu.slopeClass);
    add(prefix, 'Slope Range', mu.slopeMin != null ? `${mu.slopeMin}–${mu.slopeMax}%` : null);
    add(prefix, 'Drainage Class', mu.drainage);
    add(prefix, 'Hydrologic Group', mu.hydrologicGroup);
    add(prefix, 'Hydric Soil', mu.hydric ? 'Yes' : 'No');
    add(prefix, 'Taxonomy Order', mu.taxOrder);
  });

  // Elevation / Topography
  if (elevation && !elevation.error) {
    add('Topography', 'Min Elevation (ft)', elevation.minElevationFt);
    add('Topography', 'Max Elevation (ft)', elevation.maxElevationFt);
    add('Topography', 'Elevation Range (ft)', elevation.elevationRangeFt);
    add('Topography', 'Est. Max Slope (%)', elevation.estimatedMaxSlopePct);
    add('Topography', 'Slopes > 15%', elevation.hasSteepSlopes ? 'Yes' : 'No');
  }

  // Buildings
  if (buildings && !buildings.error) {
    add('Buildings', 'Structure Count', buildings.count);
    (buildings.structures || []).forEach(s => {
      add('Buildings', `Structure ${s.id} (sq ft)`, s.squareFeet);
    });
  }

  // Wetlands
  if (wetlands && !wetlands.error) {
    add('Wetlands', 'Wetlands Present', wetlands.present ? 'Yes' : 'No');
    add('Wetlands', 'Feature Count', wetlands.count);
    add('Wetlands', 'Types', (wetlands.types || []).join('; '));
    add('Wetlands', 'Total Acres', wetlands.totalAcres);
  }

  const csv = Papa.unparse(rows);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const date = new Date().toISOString().slice(0, 10);
  a.download = `SiteScope_Data_${date}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Component ─────────────────────────────────────────────────────
export default function ExportPanel({
  location, parcel, flood, soil, elevation, buildings, wetlands,
  mapRef, dataPanelRef,
}) {
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState(null);
  const panelRef = useRef(null);

  const address = location?.displayName?.split(',').slice(0, 3).join(', ') || 'Unknown';

  const handleExport = async format => {
    setExporting(format);
    setOpen(false);
    try {
      if (format === 'pdf') {
        await exportPDF({ address, mapRef, dataPanelRef });
      } else if (format === 'png') {
        await exportPNG({ mapRef });
      } else if (format === 'csv') {
        exportCSV({ location, parcel, flood, soil, elevation, buildings, wetlands });
      }
    } catch (e) {
      console.error('Export error:', e);
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="export-panel" ref={panelRef}>
      <button
        className="export-btn"
        onClick={() => setOpen(o => !o)}
        aria-label="Export report"
        aria-expanded={open}
        disabled={!!exporting}
      >
        {exporting ? (
          <span className="export-spinner" />
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        )}
        <span>{exporting ? `Exporting ${exporting.toUpperCase()}…` : 'Export'}</span>
        {!exporting && <span className="export-chevron">▼</span>}
      </button>

      {open && (
        <div className="export-dropdown">
          <button className="export-option" onClick={() => handleExport('pdf')}>
            <span className="export-option-icon">📄</span>
            <div>
              <div className="export-option-name">PDF Report</div>
              <div className="export-option-desc">Map + data summary</div>
            </div>
          </button>
          <button className="export-option" onClick={() => handleExport('png')}>
            <span className="export-option-icon">🗺️</span>
            <div>
              <div className="export-option-name">PNG Map</div>
              <div className="export-option-desc">Map with active layers</div>
            </div>
          </button>
          <button className="export-option" onClick={() => handleExport('csv')}>
            <span className="export-option-icon">📊</span>
            <div>
              <div className="export-option-name">CSV Data</div>
              <div className="export-option-desc">All data panel fields</div>
            </div>
          </button>
        </div>
      )}
    </div>
  );
}
