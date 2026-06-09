export function getFeatureCentroid(geometry) {
  if (!geometry) return null;

  let ring;
  if (geometry.type === 'Polygon') {
    ring = geometry.coordinates[0];
  } else if (geometry.type === 'MultiPolygon') {
    ring = geometry.coordinates[0][0];
  } else {
    return null;
  }

  const points = ring.length > 1 ? ring.slice(0, -1) : ring;
  let lat = 0;
  let lng = 0;

  for (const [lngVal, latVal] of points) {
    lng += lngVal;
    lat += latVal;
  }

  return { lat: lat / points.length, lng: lng / points.length };
}
