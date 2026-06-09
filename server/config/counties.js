/**
 * County configuration for parcel data routing.
 *
 * To add a new county: add an entry to COUNTIES using the county name (lowercase,
 * no "county" suffix) as the key. No other code changes required.
 *
 * fields: maps normalized property names to the county GIS layer's actual field names.
 */

const COUNTIES = {
  york: {
    name: 'York County',
    state: 'Pennsylvania',
    parcelEndpoint:
      'https://services.pasda.psu.edu/server/rest/services/pasda/YorkCounty/MapServer/31/query',
    fields: {
      ownerName: 'OWNNAME1',
      ownerName2: 'OWNNAME2',
      parcelId: 'PIN',
      // SHAPE_Area is in sq ft for this layer; set acreageDirect: null to trigger conversion
      acreage: 'SHAPE_Area',
      acreageDirect: null,
      municipality: 'MUNI_NAME',
      siteAddress: 'SITEADDRESS',
    },
    acreageFromShapeArea: true,
  },

  adams: {
    name: 'Adams County',
    state: 'Pennsylvania',
    parcelEndpoint:
      'https://mapping.adamscountypa.gov/arcgis/rest/services/AGOL/Parcel_Owners/MapServer/0/query',
    fields: {
      ownerName: 'OWNER_NAME',
      ownerName2: 'OWNER_NAME2',
      parcelId: 'PARCEL_ID',
      acreage: null,
      acreageDirect: 'ACRES',
      municipality: 'MUNICIPALITY',
      siteAddress: 'SITEADDR',
    },
    acreageFromShapeArea: false,
  },
};

/**
 * Given a county name string from reverse geocoding (e.g. "York County"),
 * return the matching key in COUNTIES or null if unsupported.
 */
function resolveCountyKey(countyName) {
  if (!countyName) return null;
  const normalized = countyName
    .toLowerCase()
    .replace(/\s*county\s*/gi, '')
    .trim();
  return COUNTIES[normalized] ? normalized : null;
}

module.exports = { COUNTIES, resolveCountyKey };
