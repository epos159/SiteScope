/**
 * Official county assessment / property-record search portals.
 * Links open the public search landing page (most require a disclaimer
 * or manual search — deep-linking to a single parcel is rarely supported).
 */
export const ASSESSMENT_PORTALS = {
  york: {
    label: 'York County Assessment',
    url: 'https://assessmentpublic.yorkcountypa.gov/search/commonsearch.aspx?mode=realprop',
    hint: 'Building size, assessed value, and tax detail',
  },
  lancaster: {
    label: 'Lancaster County Assessment',
    url: 'https://lancasterpa.devnetwedge.com/',
    hint: 'Property record card, sketches, and assessed value',
  },
  dauphin: {
    label: 'Dauphin County Assessment',
    url: 'https://dauphinpa.devnetwedge.com/',
    hint: 'Property record card, square footage, and assessed value',
  },
  cumberland: {
    label: 'Cumberland County Assessment (DataScout)',
    url: 'https://www.actdatascout.com/RealProperty/Pennsylvania/Cumberland',
    hint: 'Property record card, characteristics, and assessed value',
  },
  adams: {
    label: 'Adams County Property Search',
    url: 'https://adamscountypa.taxandrevenue.opengov.com/',
    hint: 'Property and tax records by PIDN or address',
  },
  franklin: {
    label: 'Franklin County Tax Parcel Viewer',
    url: 'https://fcgis.franklincountypa.gov/taxparcelviewer',
    hint: 'Public assessment map and limited parcel details',
  },
};

export function getAssessmentPortal(countyKey) {
  if (!countyKey) return null;
  return ASSESSMENT_PORTALS[String(countyKey).toLowerCase()] || null;
}
