/**
 * Lightweight client check: does the parcel situs look like what the user searched?
 * Used to suppress false-alarm warnings when the API match metadata lags.
 */
export function addressesAppearAligned(searchedAddress, siteAddress) {
  if (!searchedAddress?.trim() || !siteAddress?.trim()) return false;

  const search = searchedAddress.toUpperCase();
  const site = siteAddress.toUpperCase();

  const houseMatch = search.match(/^(\d+[A-Z]?)\b/);
  if (houseMatch) {
    const num = houseMatch[1];
    const numPattern = new RegExp(`(^|\\s)${num}(\\s|$|[A-Z])`, 'i');
    if (!numPattern.test(site)) return false;
  }

  const streetPart = search.split(',')[0].replace(/^\d+[A-Z]?\s*/i, '');
  const tokens = streetPart
    .toUpperCase()
    .replace(/\b(RD|ROAD|DR|DRIVE|LN|LANE|ST|STREET|AVE|AVENUE|BLVD|CT|COURT|WAY|PL|PLACE|CIR|CIRCLE)\b\.?/gi, '')
    .split(/\s+/)
    .filter(t => t.length > 2);

  if (tokens.length === 0) return site.includes(search.split(',')[0].trim().toUpperCase());

  const matched = tokens.filter(t => site.includes(t)).length;
  return matched >= Math.min(tokens.length, 1);
}

export function shouldShowParcelMatchWarning({ data, location, siteAddress }) {
  if (!location?.searchedAddress?.trim()) return false;
  if (data?.matchConfidence === 'high') return false;
  if (addressesAppearAligned(location.searchedAddress, siteAddress)) return false;
  return data?.matchMethod === 'point' && data?.matchConfidence === 'low';
}
