/** County records are stored in caps ("370 BOWERS BRIDGE RD") — show them as "370 Bowers Bridge Rd". */
export function toTitleCase(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\b([a-z])/g, letter => letter.toUpperCase());
}

/** "370 Bowers Bridge Rd, Conewago Township, York County, PA" */
export function formatCountyMatchLabel({ address, municipality, countyName }) {
  return [toTitleCase(address), toTitleCase(municipality), countyName, 'PA'].filter(Boolean).join(', ');
}
