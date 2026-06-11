/**
 * Guess supported county from coordinates (mirrors server logic).
 */
export function inferCountyKey(lat, lng) {
  const latF = parseFloat(lat);
  const lngF = parseFloat(lng);
  if (Number.isNaN(latF) || Number.isNaN(lngF)) return null;

  if (latF >= 39.72 && latF <= 40.18 && lngF >= -77.15 && lngF <= -76.35) {
    return 'york';
  }

  if (latF >= 39.68 && latF <= 40.12 && lngF >= -77.55 && lngF <= -76.75) {
    return 'adams';
  }

  return null;
}
