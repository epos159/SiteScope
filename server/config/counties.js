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
    // York County Planning Commission (YCPC) open-data parcel service for York County, PA.
    // NOTE: maps.yorkcounty.gov is a DIFFERENT county (York County, VIRGINIA) — do not use it.
    parcelEndpoint:
      'https://arcweb1.ycpc.org/server/rest/services/OPEN_DATA/Parcels/FeatureServer/0/query',
    fields: {
      ownerName: 'OWNER_FULL',
      ownerName2: 'OWN_NAME2',
      parcelId: 'PIDN',
      acreage: null,
      acreageDirect: 'ACRES',
      municipality: null,
      districtField: 'DISTRICT',
      siteAddress: 'PROPADR',
    },
    acreageFromShapeArea: false,
    addressSearch: {
      siteAddress: 'PROPADR',
      streetNumber: 'SITE_ST_NO',
      streetName: 'SITE_ST_NAME',
    },
    districtLookup: {
      '01': 'York City Ward 1',
      '02': 'York City Ward 2',
      '03': 'York City Ward 3',
      '04': 'York City Ward 4',
      '05': 'York City Ward 5',
      '06': 'York City Ward 6',
      '07': 'York City Ward 7',
      '08': 'York City Ward 8',
      '09': 'York City Ward 9',
      '10': 'York City Ward 10',
      '11': 'York City Ward 11',
      '12': 'York City Ward 12',
      '13': 'York City Ward 13',
      '14': 'York City Ward 14',
      '15': 'York City Ward 15',
      '20': 'Carroll Township',
      '21': 'Chanceford Township',
      '22': 'Codorus Township',
      '23': 'Conewago Township',
      '24': 'Dover Township',
      '25': 'East Hopewell Township',
      '26': 'East Manchester Township',
      '27': 'Fairview Township',
      '28': 'Fawn Township',
      '29': 'Franklin Township',
      '30': 'Heidelberg Township',
      '31': 'Hellam Township',
      '32': 'Hopewell Township',
      '33': 'Jackson Township',
      '34': 'Lower Chanceford Township',
      '35': 'Lower Windsor Township',
      '36': 'Manchester Township',
      '37': 'Manheim Township',
      '38': 'Monaghan Township',
      '39': 'Newberry Township',
      '40': 'North Codorus Township',
      '41': 'North Hopewell Township',
      '42': 'Paradise Township',
      '43': 'Peach Bottom Township',
      '44': 'Penn Township',
      '45': 'Shrewsbury Township',
      '46': 'Springettsbury Township',
      '47': 'Springfield Township',
      '48': 'Spring Garden Township',
      '49': 'Warrington Township',
      '50': 'Washington Township',
      '51': 'West Manchester Township',
      '52': 'West Manheim Township',
      '53': 'Windsor Township',
      '54': 'York Township',
      '55': 'Cross Roads Borough',
      '56': 'Dallastown Borough',
      '57': 'Delta Borough',
      '58': 'Dillsburg Borough',
      '59': 'Dover Borough',
      '60': 'East Prospect Borough',
      '61': 'Fawn Grove Borough',
      '62': 'Felton Borough',
      '63': 'Franklintown Borough',
      '64': 'Glen Rock Borough',
      '65': 'Goldsboro Borough',
      '66': 'Hallam Borough',
      '67': 'Hanover Borough',
      '72': 'Jacobus Borough',
      '73': 'Jefferson Borough',
      '74': 'Lewisberry Borough',
      '75': 'Loganville Borough',
      '76': 'Manchester Borough',
      '77': 'Mount Wolf Borough',
      '78': 'New Freedom Borough',
      '79': 'New Salem Borough',
      '80': 'North York Borough',
      '81': 'Railroad Borough',
      '82': 'Red Lion Borough',
      '83': 'Seven Valleys Borough',
      '84': 'Shrewsbury Borough',
      '85': 'Spring Grove Borough',
      '86': 'Stewartstown Borough',
      '87': 'Wellsville Borough',
      '88': 'West York Borough',
      '89': 'Windsor Borough',
      '90': 'Winterstown Borough',
      '91': 'Wrightsville Borough',
      '92': 'Yoe Borough',
      '93': 'Yorkana Borough',
      '94': 'York Haven Borough',
    },
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
    addressSearch: {
      siteAddress: 'SITEADDR',
    },
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

/**
 * Guess supported county from coordinates when geocoder omits county.
 */
function inferCountyKeyFromCoords(lat, lng) {
  const latF = parseFloat(lat);
  const lngF = parseFloat(lng);
  if (Number.isNaN(latF) || Number.isNaN(lngF)) return null;

  // York County, PA (approximate bounds)
  if (latF >= 39.72 && latF <= 40.18 && lngF >= -77.15 && lngF <= -76.35) {
    return 'york';
  }

  // Adams County, PA (approximate bounds)
  if (latF >= 39.68 && latF <= 40.12 && lngF >= -77.55 && lngF <= -76.75) {
    return 'adams';
  }

  return null;
}

module.exports = { COUNTIES, resolveCountyKey, inferCountyKeyFromCoords };
