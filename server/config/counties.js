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
      'https://maps.yorkcounty.gov/arcgis/rest/services/AGOservices/Landrecords_Service/FeatureServer/7/query',
    fields: {
      ownerName: 'ownerName',
      ownerName2: null,
      parcelId: 'GPIN',
      acreage: null,
      acreageDirect: 'legalAcres',
      municipality: 'magesterialDistrict',
      siteAddress: 'ADDRESS',
    },
    acreageFromShapeArea: false,
    addressSearch: {
      siteAddress: 'ADDRESS',
      streetNumber: 'VIS_streetNumber',
      streetName: 'VIS_streetName',
    },
    // Fallback if the primary county endpoint is unavailable
    fallbackEndpoint:
      'https://services.pasda.psu.edu/server/rest/services/pasda/YorkCounty/MapServer/31/query',
    fallbackFields: {
      ownerName: 'OWNER_FULL',
      ownerName2: 'OWN_NAME2',
      parcelId: 'PIDN',
      acreage: 'Shape_Area',
      acreageDirect: null,
      municipality: null,
      siteAddress: 'PROPADR',
      districtField: 'DISTRICT',
    },
    fallbackAddressSearch: {
      siteAddress: 'PROPADR',
    },
    districtLookup: {
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

module.exports = { COUNTIES, resolveCountyKey };
