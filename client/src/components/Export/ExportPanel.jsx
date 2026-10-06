import React, { useState, useRef, useEffect } from 'react';
import Papa from 'papaparse';
import { DISCLAIMER_FULL } from '../../constants/disclaimer';
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

function formatDate() {
  return new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
}

function safeFilename(address) {
  return address.replace(/[^a-z0-9]/gi, '_').slice(0, 40);
}

/** Build flat report rows used by PDF tables and CSV. */
function buildReportRows({ location, parcel, flood, soil, elevation, wetlands }) {
  const sections = [];

  const pushSection = (title, fields) => {
    const filled = fields.filter(([, value]) => value != null && value !== '');
    if (filled.length) sections.push({ title, fields: filled });
  };

  pushSection('Location', [
    ['Address', location?.displayName],
    ['County', location?.county],
    ['State', location?.state],
    ['Latitude', location?.lat],
    ['Longitude', location?.lng],
  ]);

  const p = parcel?.feature?.properties;
  if (p) {
    pushSection('Parcel', [
      ['Owner', p.ownerName],
      ['Owner 2', p.ownerName2],
      ['Parcel ID', p.parcelId],
      ['Acreage', p.acreage != null ? `${p.acreage} ac` : null],
      ['Municipality', p.municipality],
      ['County', p.county],
      ['Site Address', p.siteAddress],
    ]);
  }

  const neighbors = parcel?.neighbors || [];
  if (neighbors.length) {
    pushSection(
      'Adjoining Landowners',
      neighbors.map((n, i) => [`Neighbor ${i + 1}`, n.ownerName])
    );
  }

  if (flood && !flood.error) {
    pushSection('Flood', [
      ['Zone', flood.zone],
      ['Description', flood.description],
      ['SFHA', flood.sfha ? 'Yes' : 'No'],
      ['Zones on Parcel', flood.allZones?.length > 1 ? flood.allZones.join(', ') : null],
      ['Base Flood Elevation', flood.staticBfe != null ? `${flood.staticBfe} ${flood.lenUnit || 'ft'}` : null],
      ['FIRM Panel', flood.firmPanel],
    ]);
  }

  (soil?.mapUnits || []).forEach((mu, i) => {
    pushSection(`Soil Unit ${i + 1}${mu.symbol ? ` (${mu.symbol})` : ''}`, [
      ['Name', mu.name],
      ['Component %', mu.componentPct],
      ['Slope Class', mu.slopeClass],
      ['Slope Range', mu.slopeMin != null ? `${mu.slopeMin}–${mu.slopeMax}%` : null],
      ['Drainage', mu.drainage],
      ['Hydrologic Group', mu.hydrologicGroup],
      ['Hydric', mu.hydric ? 'Yes' : 'No'],
      ['Taxonomy', mu.taxOrder],
    ]);
  });

  if (elevation && !elevation.error) {
    pushSection('Topography', [
      ['Min Elevation', elevation.minElevationFt != null ? `${elevation.minElevationFt} ft` : null],
      ['Max Elevation', elevation.maxElevationFt != null ? `${elevation.maxElevationFt} ft` : null],
      ['Elevation Range', elevation.elevationRangeFt != null ? `${elevation.elevationRangeFt} ft` : null],
      ['Est. Max Slope', elevation.estimatedMaxSlopePct != null ? `${elevation.estimatedMaxSlopePct}%` : null],
      ['Slopes > 15%', elevation.hasSteepSlopes ? 'Yes' : 'No'],
    ]);
  }

  if (wetlands && !wetlands.error) {
    pushSection('Wetlands', [
      ['Present', wetlands.present ? 'Yes' : 'No'],
      ['Feature Count', wetlands.count],
      ['Types', (wetlands.types || []).join('; ')],
      ['Total Acres', wetlands.totalAcres],
    ]);
  }

  return sections;
}

function drawHeader(pdf, { address, date, pageW, margin }) {
  pdf.setFillColor(26, 41, 64);
  pdf.rect(0, 0, pageW, 52, 'F');
  pdf.setTextColor(255, 255, 255);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(16);
  pdf.text('SiteScope Site Research Report', margin, 24);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.text(String(address), margin, 38);
  pdf.text(`Generated ${date}`, margin, 49);
}

function drawFooters(pdf, { pageW, pageH, margin, contentW }) {
  const totalPages = pdf.internal.getNumberOfPages();
  const footerH = 52;
  for (let i = 1; i <= totalPages; i++) {
    pdf.setPage(i);
    pdf.setFillColor(240, 242, 245);
    pdf.rect(0, pageH - footerH, pageW, footerH, 'F');
    pdf.setTextColor(100, 116, 139);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7);
    const disclaimerLines = pdf.splitTextToSize(DISCLAIMER_FULL, contentW);
    pdf.text(disclaimerLines, margin, pageH - footerH + 12);
    pdf.setFontSize(8);
    pdf.text('SiteScope by Posch Ventures — poschventures.com', margin, pageH - 10);
    pdf.text(`Page ${i} of ${totalPages}`, pageW - margin, pageH - 10, { align: 'right' });
  }
}

/**
 * Draw labeled field rows as sharp PDF text (not a screenshot).
 * Returns the next y position.
 */
function drawTextSections(pdf, sections, { startY, pageH, pageW, margin, contentW, footerReserve = 60 }) {
  let y = startY;
  const labelW = 130;
  const valueX = margin + labelW;
  const valueW = contentW - labelW;
  const bottom = pageH - footerReserve;

  const ensureSpace = needed => {
    if (y + needed > bottom) {
      pdf.addPage();
      y = 36;
    }
  };

  for (const section of sections) {
    ensureSpace(28);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(11);
    pdf.setTextColor(26, 41, 64);
    pdf.text(section.title, margin, y);
    y += 6;
    pdf.setDrawColor(203, 213, 225);
    pdf.setLineWidth(0.6);
    pdf.line(margin, y, margin + contentW, y);
    y += 14;

    for (const [label, value] of section.fields) {
      const valueLines = pdf.splitTextToSize(String(value), valueW);
      const rowH = Math.max(12, valueLines.length * 11);
      ensureSpace(rowH + 4);

      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
      pdf.setTextColor(100, 116, 139);
      pdf.text(label, margin, y);

      pdf.setTextColor(30, 41, 59);
      pdf.text(valueLines, valueX, y);
      y += rowH;
    }

    y += 10;
  }

  return y;
}

async function captureMap(mapRef) {
  if (!mapRef?.current) return null;
  const mapEl = mapRef.current.querySelector('.map-container') || mapRef.current;
  return captureElement(mapEl);
}

async function exportPDF({
  mode,
  address,
  mapRef,
  location,
  parcel,
  flood,
  soil,
  elevation,
  wetlands,
}) {
  const { jsPDF } = await import('jspdf');
  const date = formatDate();
  const landscape = mode === 'map-first';
  const pdf = new jsPDF({
    orientation: landscape ? 'landscape' : 'portrait',
    unit: 'pt',
    format: 'letter',
  });

  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 36;
  const contentW = pageW - margin * 2;
  const footerReserve = 60;

  drawHeader(pdf, { address, date, pageW, margin });
  let y = 68;

  // Map snapshot
  try {
    const canvas = await captureMap(mapRef);
    if (canvas) {
      const imgData = canvas.toDataURL('image/jpeg', 0.9);
      const maxMapH = landscape
        ? pageH - 68 - footerReserve - 8
        : mode === 'compact'
          ? 280
          : 240;
      const naturalH = (canvas.height / canvas.width) * contentW;
      const mapH = Math.min(naturalH, maxMapH);
      pdf.addImage(imgData, 'JPEG', margin, y, contentW, mapH);
      y += mapH + 16;

      if (landscape) {
        // Map-first: data always starts on page 2 so the map stays large.
        pdf.addPage();
        y = 36;
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(12);
        pdf.setTextColor(26, 41, 64);
        pdf.text('Site Data Summary', margin, y);
        y += 18;
      }
    }
  } catch (e) {
    console.warn('Map capture failed:', e);
  }

  const sections = buildReportRows({ location, parcel, flood, soil, elevation, wetlands });
  drawTextSections(pdf, sections, { startY: y, pageH, pageW, margin, contentW, footerReserve });
  drawFooters(pdf, { pageW, pageH, margin, contentW });

  const suffix = mode === 'map-first' ? 'MapFirst' : 'Compact';
  pdf.save(`SiteScope_${safeFilename(address)}_${suffix}_${date.replace(/\s/g, '-')}.pdf`);
}

async function exportPNG({ mapRef }) {
  if (!mapRef?.current) return;
  try {
    const canvas = await captureMap(mapRef);
    if (!canvas) return;
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `SiteScope_Map_${new Date().toISOString().slice(0, 10)}.png`;
    a.click();
  } catch (e) {
    console.error('PNG export failed:', e);
  }
}

function exportCSV({ location, parcel, flood, soil, elevation, wetlands }) {
  const sections = buildReportRows({ location, parcel, flood, soil, elevation, wetlands });
  const rows = [];
  for (const section of sections) {
    for (const [field, value] of section.fields) {
      rows.push({ Section: section.title, Field: field, Value: String(value) });
    }
  }

  const csv = Papa.unparse(rows);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `SiteScope_Data_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function printReport() {
  document.body.classList.add('print-report');
  const cleanup = () => {
    document.body.classList.remove('print-report');
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  // Fallback if afterprint never fires (some browsers).
  setTimeout(cleanup, 60_000);
  window.print();
}

export default function ExportPanel({
  location, parcel, flood, soil, elevation, wetlands,
  mapRef, dataPanelRef,
}) {
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState(null);
  const panelRef = useRef(null);

  const address = location?.displayName?.split(',').slice(0, 3).join(', ') || 'Unknown';

  useEffect(() => {
    if (!open) return undefined;
    const onClick = e => {
      if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const handleExport = async format => {
    setExporting(format);
    setOpen(false);
    try {
      if (format === 'pdf-compact') {
        await exportPDF({
          mode: 'compact',
          address,
          mapRef,
          location,
          parcel,
          flood,
          soil,
          elevation,
          wetlands,
        });
      } else if (format === 'pdf-map') {
        await exportPDF({
          mode: 'map-first',
          address,
          mapRef,
          location,
          parcel,
          flood,
          soil,
          elevation,
          wetlands,
        });
      } else if (format === 'png') {
        await exportPNG({ mapRef });
      } else if (format === 'csv') {
        exportCSV({ location, parcel, flood, soil, elevation, wetlands });
      } else if (format === 'print') {
        printReport();
      }
    } catch (e) {
      console.error('Export error:', e);
    } finally {
      setExporting(null);
    }
  };

  // dataPanelRef kept for API compatibility; PDFs now use text tables.
  void dataPanelRef;

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
        <span>{exporting ? 'Exporting…' : 'Export'}</span>
        {!exporting && <span className="export-chevron">▼</span>}
      </button>

      {open && (
        <div className="export-dropdown">
          <div className="export-dropdown-label">PDF reports</div>
          <button className="export-option" onClick={() => handleExport('pdf-map')}>
            <span className="export-option-icon">🗺️</span>
            <div>
              <div className="export-option-name">Map-first PDF</div>
              <div className="export-option-desc">Large landscape map + data pages</div>
            </div>
          </button>
          <button className="export-option" onClick={() => handleExport('pdf-compact')}>
            <span className="export-option-icon">📄</span>
            <div>
              <div className="export-option-name">Compact PDF</div>
              <div className="export-option-desc">Portrait summary for email</div>
            </div>
          </button>

          <div className="export-dropdown-label">Other</div>
          <button className="export-option" onClick={() => handleExport('print')}>
            <span className="export-option-icon">🖨️</span>
            <div>
              <div className="export-option-name">Print report</div>
              <div className="export-option-desc">Browser print / Save as PDF</div>
            </div>
          </button>
          <button className="export-option" onClick={() => handleExport('png')}>
            <span className="export-option-icon">🖼️</span>
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
