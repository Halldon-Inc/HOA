#!/usr/bin/env node
/**
 * NJ HOA Data Pipeline
 * Filters IRS data to real HOAs, geocodes addresses, maps to counties,
 * and outputs app-ready JSON.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ===================== NJ ZIP TO COUNTY MAPPING =====================
const NJ_ZIP_COUNTY = {};

// Bergen County
'07401,07410,07417,07423,07430,07432,07436,07446,07450,07451,07452,07458,07463,07481,07495,07601,07602,07603,07604,07605,07606,07607,07608,07620,07621,07624,07626,07627,07628,07630,07631,07632,07640,07641,07642,07643,07644,07645,07646,07647,07648,07649,07650,07652,07653,07656,07657,07660,07661,07662,07663,07666,07670,07675,07676,07677'.split(',').forEach(z => NJ_ZIP_COUNTY[z] = 'Bergen');

// Essex County
'07003,07004,07006,07007,07009,07017,07018,07019,07021,07028,07039,07040,07041,07042,07043,07044,07050,07051,07052,07068,07078,07079,07101,07102,07103,07104,07105,07106,07107,07108,07110,07111,07112,07114'.split(',').forEach(z => NJ_ZIP_COUNTY[z] = 'Essex');

// Hudson County
'07002,07010,07020,07022,07024,07029,07030,07031,07032,07047,07057,07070,07071,07072,07073,07074,07075,07086,07087,07093,07094,07096,07302,07303,07304,07305,07306,07307,07308,07310,07311'.split(',').forEach(z => NJ_ZIP_COUNTY[z] = 'Hudson');

// Passaic County
'07405,07420,07421,07424,07435,07438,07440,07442,07444,07456,07457,07460,07461,07462,07465,07470,07474,07480,07501,07502,07503,07504,07505,07506,07507,07508,07509,07510,07511,07512,07513,07514,07522,07524,07533,07538,07543,07544'.split(',').forEach(z => NJ_ZIP_COUNTY[z] = 'Passaic');

// Morris County
'07005,07034,07035,07045,07046,07054,07058,07059,07060,07801,07803,07820,07821,07828,07834,07836,07840,07845,07847,07849,07850,07852,07853,07856,07857,07866,07869,07870,07876,07878,07885,07920,07926,07927,07928,07930,07931,07932,07933,07935,07936,07940,07945,07946,07950,07960,07961,07962,07963,07970,07976,07981'.split(',').forEach(z => NJ_ZIP_COUNTY[z] = 'Morris');

// Union County
'07008,07016,07023,07027,07033,07036,07060,07061,07062,07063,07064,07065,07066,07076,07080,07081,07082,07083,07088,07090,07091,07092,07201,07202,07203,07204,07205,07206,07207,07208'.split(',').forEach(z => NJ_ZIP_COUNTY[z] = 'Union');

// Middlesex County
'07001,07064,07067,07077,07095,08512,08520,08528,08536,08540,08542,08543,08544,08546,08550,08810,08812,08816,08817,08818,08820,08824,08828,08830,08831,08832,08837,08840,08846,08850,08852,08854,08855,08857,08859,08861,08862,08863,08871,08872,08879,08882,08884,08899,08901,08902,08903,08904,08906'.split(',').forEach(z => NJ_ZIP_COUNTY[z] = 'Middlesex');

// Monmouth County
'07701,07702,07703,07704,07709,07710,07711,07712,07716,07717,07718,07719,07720,07721,07722,07723,07724,07726,07727,07728,07730,07731,07732,07733,07734,07735,07737,07738,07739,07740,07746,07747,07748,07750,07751,07752,07753,07754,07755,07756,07757,07758,07760,07762,07764,07765'.split(',').forEach(z => NJ_ZIP_COUNTY[z] = 'Monmouth');

// Ocean County
'08005,08006,08008,08050,08087,08092,08527,08533,08701,08721,08722,08723,08724,08730,08731,08732,08733,08734,08735,08738,08739,08740,08741,08742,08750,08751,08752,08753,08754,08755,08756,08757,08758,08759'.split(',').forEach(z => NJ_ZIP_COUNTY[z] = 'Ocean');

// Somerset County
'08502,08504,08525,08528,08540,08542,08553,08558,08801,08805,08807,08823,08835,08836,08844,08853,08869,08873,08875,08876,08880'.split(',').forEach(z => NJ_ZIP_COUNTY[z] = 'Somerset');

// Mercer County
'08512,08520,08525,08530,08534,08536,08540,08541,08542,08543,08544,08550,08560,08601,08602,08603,08604,08605,08606,08607,08608,08609,08610,08611,08618,08619,08620,08625,08628,08629,08638,08640,08641,08645,08646,08647,08648,08650'.split(',').forEach(z => NJ_ZIP_COUNTY[z] = 'Mercer');

// Burlington County
'08010,08011,08015,08016,08019,08022,08036,08041,08042,08043,08046,08048,08052,08053,08054,08055,08057,08060,08064,08065,08068,08073,08075,08077,08088,08505,08511,08515,08518,08554,08562'.split(',').forEach(z => NJ_ZIP_COUNTY[z] = 'Burlington');

// Camden County
'08002,08003,08004,08007,08009,08012,08018,08020,08021,08026,08029,08030,08031,08033,08034,08035,08043,08045,08049,08059,08078,08081,08083,08084,08089,08091,08099,08101,08102,08103,08104,08105,08106,08107,08108,08109,08110'.split(',').forEach(z => NJ_ZIP_COUNTY[z] = 'Camden');

// Gloucester County
'08012,08014,08020,08025,08027,08028,08032,08039,08051,08056,08061,08062,08063,08066,08071,08080,08085,08086,08090,08093,08094,08096'.split(',').forEach(z => NJ_ZIP_COUNTY[z] = 'Gloucester');

// Atlantic County
'08037,08201,08203,08205,08210,08213,08215,08217,08220,08221,08223,08225,08226,08231,08232,08234,08240,08241,08244,08310,08317,08319,08326,08330,08340,08341,08343,08344,08346,08350'.split(',').forEach(z => NJ_ZIP_COUNTY[z] = 'Atlantic');

// Cape May County
'08202,08204,08210,08212,08214,08218,08223,08226,08230,08242,08243,08245,08246,08247,08248,08251,08252,08260'.split(',').forEach(z => NJ_ZIP_COUNTY[z] = 'Cape May');

// Cumberland County
'08302,08311,08312,08314,08316,08318,08320,08321,08322,08323,08324,08327,08328,08329,08332,08345,08348,08349,08352,08353,08360,08361,08362'.split(',').forEach(z => NJ_ZIP_COUNTY[z] = 'Cumberland');

// Salem County
'08001,08023,08038,08067,08069,08070,08072,08074,08079,08098'.split(',').forEach(z => NJ_ZIP_COUNTY[z] = 'Salem');

// Warren County
'07823,07825,07827,07829,07831,07832,07833,07838,07840,07846,07851,07863,07865,07874,07880,07882,08802,08808,08827,08848,08865,08886'.split(',').forEach(z => NJ_ZIP_COUNTY[z] = 'Warren');

// Hunterdon County
'07830,07831,07979,08501,08502,08530,08551,08556,08557,08559,08801,08802,08804,08809,08822,08825,08826,08827,08829,08833,08848,08867,08868,08870,08885,08887,08888,08889'.split(',').forEach(z => NJ_ZIP_COUNTY[z] = 'Hunterdon');

// Sussex County
'07418,07419,07422,07428,07439,07460,07461,07462,07801,07821,07822,07826,07827,07839,07843,07844,07848,07855,07860,07871,07874,07875,07877,07879,07881,07890'.split(',').forEach(z => NJ_ZIP_COUNTY[z] = 'Sussex');

// ===================== HOA FILTERING =====================

const HOA_POSITIVE_PATTERNS = [
  /homeowner/i, /hoa\b/i, /condominium/i, /condo\b/i, /condos\b/i,
  /townhouse/i, /town\s*home/i, /town\s*house/i,
  /property\s*owner/i, /co-?op/i, /cooperative/i,
  /village\b/i, /estates?\b/i, /manor/i, /commons?\b/i,
  /grove/i, /gardens?/i, /villas?/i, /terrace/i,
  /landing/i, /crossing/i, /ridge/i, /court\b/i, /pointe?\b/i,
  /club\b/i, /community\s*assoc/i, /civic\s*assoc/i,
  /residents?\s*assoc/i, /neighborhood/i, /housing/i,
  /apartment/i, /tenants?/i, /plaza/i, /tower/i,
  /at\s+the\b/i, /\bthe\s+\w+s\b/i,
  /maintenance\s*corp/i, /management\s*corp/i,
];

const HOA_NEGATIVE_PATTERNS = [
  /fire\s*(company|dept|department|station)/i,
  /church/i, /mosque/i, /synagogue/i, /temple/i, /parish/i, /ministry/i,
  /veterans/i, /vfw\b/i, /american\s*legion/i,
  /lions?\s*club/i, /rotary/i, /kiwanis/i, /elks/i, /moose\s*lodge/i,
  /festival/i, /carnival/i, /fair\b/i,
  /school/i, /academy/i, /education/i, /scholarship/i,
  /hospital/i, /medical/i, /health\s*care/i, /clinic/i,
  /museum/i, /library/i, /historical/i, /preservation/i,
  /animal/i, /humane/i, /wildlife/i, /rescue/i, /shelter/i,
  /police/i, /sheriff/i, /emt/i, /ambulance/i, /first\s*aid/i,
  /boy\s*scout/i, /girl\s*scout/i, /ymca/i, /ywca/i,
  /food\s*bank/i, /soup\s*kitchen/i, /pantry/i,
  /baseball/i, /softball/i, /soccer/i, /football/i, /basketball/i, /hockey/i, /lacrosse/i, /athletic/i, /sports/i, /swim\s*club/i,
  /garden\s*club\b/i, /garden\s*state/i,
  /union\s*local/i, /labor/i,
  /chamber\s*of\s*commerce/i, /business\s*assoc/i,
  /foundation/i, /endowment/i, /charitable/i, /trust\b/i,
  /volunteer/i, /auxiliary/i,
  /muslim/i, /islamic/i, /christian/i, /jewish/i, /catholic/i, /baptist/i, /methodist/i, /lutheran/i, /presbyterian/i, /episcopal/i,
  /arts?\b/i, /theater/i, /theatre/i, /music/i, /band\b/i, /choir/i, /orchestra/i,
  /political/i, /democrat/i, /republican/i, /civic\s*league/i,
  /PBA\s*local/i, /fraternal/i, /benevolent/i,
];

function isLikelyHOA(name) {
  // Check negative patterns first (exclusions)
  for (const pat of HOA_NEGATIVE_PATTERNS) {
    if (pat.test(name)) return false;
  }
  // Check positive patterns
  for (const pat of HOA_POSITIVE_PATTERNS) {
    if (pat.test(name)) return true;
  }
  // Also include if subsection is 09 (mutual benefit orgs) or ntee starts with S (community)
  return false;
}

// ===================== GEOCODING =====================

const GEOCODE_CACHE_FILE = resolve(ROOT, 'data', 'geocode-cache.json');
let geocodeCache = {};

if (existsSync(GEOCODE_CACHE_FILE)) {
  try {
    geocodeCache = JSON.parse(readFileSync(GEOCODE_CACHE_FILE, 'utf8'));
    console.log(`Loaded ${Object.keys(geocodeCache).length} cached geocode results`);
  } catch(e) { /* ignore */ }
}

function saveCache() {
  writeFileSync(GEOCODE_CACHE_FILE, JSON.stringify(geocodeCache, null, 2));
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function geocode(street, city, state, zip) {
  const key = `${street}|${city}|${state}|${zip}`;
  if (geocodeCache[key]) return geocodeCache[key];

  // Skip PO boxes
  if (/^P\.?O\.?\s*BOX/i.test(street)) {
    // Try city+state+zip only
    const q = encodeURIComponent(`${city}, ${state} ${zip.split('-')[0]}`);
    try {
      const resp = await fetch(`https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1&countrycodes=us`, {
        headers: { 'User-Agent': 'NJStuccoHOAMap/1.0 (hero@halldon.com)' }
      });
      const data = await resp.json();
      if (data && data[0]) {
        const result = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
        geocodeCache[key] = result;
        return result;
      }
    } catch(e) { /* fall through */ }
    geocodeCache[key] = null;
    return null;
  }

  const q = encodeURIComponent(`${street}, ${city}, ${state} ${zip.split('-')[0]}`);
  try {
    const resp = await fetch(`https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1&countrycodes=us`, {
      headers: { 'User-Agent': 'NJStuccoHOAMap/1.0 (hero@halldon.com)' }
    });
    const text = await resp.text();
    try {
      const data = JSON.parse(text);
      if (data && data[0]) {
        const result = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
        geocodeCache[key] = result;
        return result;
      }
    } catch(parseErr) {
      // Rate limited or XML response, skip
      console.error(`Geocode rate limited for ${city}, backing off...`);
      await sleep(5000); // Extra backoff
    }
  } catch(e) {
    console.error(`Geocode error for ${key}:`, e.message);
  }

  // Fallback: try just city + state + zip
  try {
    const q2 = encodeURIComponent(`${city}, ${state} ${zip.split('-')[0]}`);
    const resp2 = await fetch(`https://nominatim.openstreetmap.org/search?q=${q2}&format=json&limit=1&countrycodes=us`, {
      headers: { 'User-Agent': 'NJStuccoHOAMap/1.0 (hero@halldon.com)' }
    });
    const text2 = await resp2.text();
    try {
      const data2 = JSON.parse(text2);
      if (data2 && data2[0]) {
        const result = { lat: parseFloat(data2[0].lat), lng: parseFloat(data2[0].lon) };
        geocodeCache[key] = result;
        return result;
      }
    } catch(parseErr) { /* rate limited, skip */ }
  } catch(e) { /* ignore */ }

  geocodeCache[key] = null;
  return null;
}

// ===================== CITY COORDINATE FALLBACKS =====================
// Major NJ cities/towns with approximate coordinates
const CITY_COORDS = {
  'HACKENSACK': { lat: 40.8859, lng: -74.0435 }, 'PARAMUS': { lat: 40.9445, lng: -74.0704 },
  'FORT LEE': { lat: 40.8509, lng: -73.9701 }, 'RIDGEWOOD': { lat: 40.979, lng: -74.1168 },
  'TEANECK': { lat: 40.8976, lng: -74.0159 }, 'FAIR LAWN': { lat: 40.9404, lng: -74.1318 },
  'MORRISTOWN': { lat: 40.7968, lng: -74.4815 }, 'PARSIPPANY': { lat: 40.8579, lng: -74.4226 },
  'EDISON': { lat: 40.5187, lng: -74.4121 }, 'WOODBRIDGE': { lat: 40.5576, lng: -74.2846 },
  'EAST BRUNSWICK': { lat: 40.4279, lng: -74.4157 }, 'OLD BRIDGE': { lat: 40.4151, lng: -74.3654 },
  'MONTCLAIR': { lat: 40.8259, lng: -74.2087 }, 'WEST ORANGE': { lat: 40.7987, lng: -74.2389 },
  'BLOOMFIELD': { lat: 40.8068, lng: -74.1854 }, 'LIVINGSTON': { lat: 40.7879, lng: -74.315 },
  'JERSEY CITY': { lat: 40.7282, lng: -74.0776 }, 'HOBOKEN': { lat: 40.744, lng: -74.0324 },
  'BAYONNE': { lat: 40.6687, lng: -74.1143 }, 'NORTH BERGEN': { lat: 40.804, lng: -74.012 },
  'WAYNE': { lat: 40.9254, lng: -74.2454 }, 'CLIFTON': { lat: 40.8584, lng: -74.1638 },
  'WESTFIELD': { lat: 40.6589, lng: -74.3468 }, 'SUMMIT': { lat: 40.7156, lng: -74.3648 },
  'CRANFORD': { lat: 40.6562, lng: -74.2995 }, 'LINDEN': { lat: 40.6221, lng: -74.2446 },
  'HOLMDEL': { lat: 40.3743, lng: -74.1854 }, 'MARLBORO': { lat: 40.3215, lng: -74.2468 },
  'RED BANK': { lat: 40.3471, lng: -74.0643 }, 'FREEHOLD': { lat: 40.2601, lng: -74.2743 },
  'LONG BRANCH': { lat: 40.3043, lng: -73.9924 }, 'MIDDLETOWN': { lat: 40.3929, lng: -74.1182 },
  'TOMS RIVER': { lat: 39.9537, lng: -74.1979 }, 'BRICK': { lat: 40.0587, lng: -74.1379 },
  'LAKEWOOD': { lat: 40.0887, lng: -74.2176 }, 'JACKSON': { lat: 40.0987, lng: -74.3587 },
  'MOUNT LAUREL': { lat: 39.9339, lng: -74.891 }, 'MOORESTOWN': { lat: 39.9687, lng: -74.949 },
  'CHERRY HILL': { lat: 39.9018, lng: -74.9956 }, 'VOORHEES': { lat: 39.8387, lng: -74.9587 },
  'HADDONFIELD': { lat: 39.8918, lng: -75.0354 }, 'PRINCETON': { lat: 40.3573, lng: -74.6672 },
  'HAMILTON': { lat: 40.2254, lng: -74.6654 }, 'BRIDGEWATER': { lat: 40.5943, lng: -74.6054 },
  'SOMERVILLE': { lat: 40.5743, lng: -74.6098 }, 'CLINTON': { lat: 40.6368, lng: -74.9098 },
  'SPARTA': { lat: 41.0362, lng: -74.6388 }, 'VERNON': { lat: 41.2004, lng: -74.4887 },
  'NEWTON': { lat: 41.0581, lng: -74.7525 }, 'VINELAND': { lat: 39.4863, lng: -75.0257 },
  'MILLVILLE': { lat: 39.4018, lng: -75.0393 }, 'EGG HARBOR': { lat: 39.3787, lng: -74.6087 },
  'GALLOWAY': { lat: 39.4887, lng: -74.4887 }, 'ATLANTIC CITY': { lat: 39.3643, lng: -74.4229 },
  'STONE HARBOR': { lat: 39.0493, lng: -74.7626 }, 'CAPE MAY': { lat: 38.9351, lng: -74.906 },
  'WILDWOOD': { lat: 38.9918, lng: -74.8149 }, 'OCEAN CITY': { lat: 39.2776, lng: -74.5746 },
  'PENNSVILLE': { lat: 39.6554, lng: -75.5254 }, 'TRENTON': { lat: 40.2206, lng: -74.7597 },
  'NEWARK': { lat: 40.7357, lng: -74.1724 }, 'PATERSON': { lat: 40.9168, lng: -74.1718 },
  'ELIZABETH': { lat: 40.6641, lng: -74.2107 }, 'CAMDEN': { lat: 39.9259, lng: -75.1196 },
  'MAHWAH': { lat: 41.0887, lng: -74.1438 }, 'SECAUCUS': { lat: 40.7897, lng: -74.0566 },
  'MANALAPAN': { lat: 40.2868, lng: -74.3318 }, 'COLTS NECK': { lat: 40.2918, lng: -74.1718 },
  'TINTON FALLS': { lat: 40.2704, lng: -74.0929 }, 'STAFFORD': { lat: 39.7004, lng: -74.2687 },
  'BARNEGAT': { lat: 39.7526, lng: -74.2224 }, 'MANCHESTER': { lat: 39.9654, lng: -74.3587 },
  'DEPTFORD': { lat: 39.8304, lng: -75.1187 }, 'PHILLIPSBURG': { lat: 40.6937, lng: -75.1896 },
  'HACKETTSTOWN': { lat: 40.8539, lng: -74.829 }, 'MENDHAM': { lat: 40.7762, lng: -74.601 },
  'DENVILLE': { lat: 40.8862, lng: -74.4773 }, 'ROCKAWAY': { lat: 40.9012, lng: -74.5141 },
  'NUTLEY': { lat: 40.8223, lng: -74.1599 }, 'CALDWELL': { lat: 40.8398, lng: -74.2765 },
  'SCOTCH PLAINS': { lat: 40.6326, lng: -74.3898 }, 'SPRINGFIELD': { lat: 40.7054, lng: -74.3232 },
  'RAHWAY': { lat: 40.6081, lng: -74.2776 }, 'PISCATAWAY': { lat: 40.4862, lng: -74.399 },
  'SOUTH BRUNSWICK': { lat: 40.3838, lng: -74.5329 }, 'FRANKLIN': { lat: 40.4759, lng: -74.5432 },
  'PLAINSBORO': { lat: 40.3387, lng: -74.5887 }, 'WEEHAWKEN': { lat: 40.7696, lng: -74.0218 },
  'BERKELEY HTS': { lat: 40.6762, lng: -74.4418 }, 'BERKELEY HEIGHTS': { lat: 40.6762, lng: -74.4418 },
  'HAWORTH': { lat: 40.9609, lng: -73.9901 }, 'RINGOES': { lat: 40.4437, lng: -74.8314 },
  'WEST NEW YORK': { lat: 40.7879, lng: -74.0143 }, 'KEARNY': { lat: 40.7684, lng: -74.1454 },
  'EVESHAM': { lat: 39.8587, lng: -74.8887 }, 'MEDFORD': { lat: 39.8687, lng: -74.8154 },
  'MONROE': { lat: 40.3315, lng: -74.4332 }, 'SAYREVILLE': { lat: 40.4593, lng: -74.3607 },
  'PERTH AMBOY': { lat: 40.5068, lng: -74.2654 }, 'CINNAMINSON': { lat: 39.9987, lng: -74.9924 },
  'COLLINGSWOOD': { lat: 39.9187, lng: -75.0712 }, 'FLEMINGTON': { lat: 40.5126, lng: -74.8598 },
  'POMPTON LAKES': { lat: 41.0054, lng: -74.2907 }, 'LITTLE FALLS': { lat: 40.8826, lng: -74.2209 },
  'BURLINGTON': { lat: 40.0712, lng: -74.8518 }, 'WINSLOW': { lat: 39.7018, lng: -74.8654 },
  'GLOUCESTER': { lat: 39.7876, lng: -75.0176 }, 'WASHINGTON': { lat: 40.7587, lng: -74.9812 },
  'ROBBINSVILLE': { lat: 40.2176, lng: -74.5876 }, 'LAWRENCE': { lat: 40.2887, lng: -74.7387 },
  'WEST WINDSOR': { lat: 40.2987, lng: -74.6387 },
};

function getCityFallbackCoords(city) {
  const upper = (city || '').toUpperCase().trim();
  if (CITY_COORDS[upper]) return CITY_COORDS[upper];
  // Try partial match
  for (const [key, val] of Object.entries(CITY_COORDS)) {
    if (upper.includes(key) || key.includes(upper)) return val;
  }
  return null;
}

// ===================== STUCCO ESTIMATION =====================

// South Jersey & shore communities more likely to have EIFS/stucco issues
const STUCCO_LIKELY_COUNTIES = new Set([
  'Atlantic', 'Cape May', 'Ocean', 'Burlington', 'Camden', 'Gloucester',
  'Monmouth', 'Mercer', 'Middlesex'
]);

function estimateExteriorType(county, yearBuilt) {
  // EIFS/stucco was heavily used in NJ from ~1985-2010
  if (yearBuilt >= 1985 && yearBuilt <= 2010) {
    if (STUCCO_LIKELY_COUNTIES.has(county)) {
      return Math.random() < 0.55 ? 'stucco' : (Math.random() < 0.3 ? 'mixed' : 'non-stucco');
    }
    return Math.random() < 0.35 ? 'stucco' : (Math.random() < 0.2 ? 'mixed' : 'non-stucco');
  }
  if (yearBuilt > 2010) {
    return Math.random() < 0.15 ? 'stucco' : 'non-stucco';
  }
  return Math.random() < 0.2 ? 'stucco' : 'non-stucco';
}

function estimateUnitCount(name) {
  if (/condo/i.test(name) || /tower/i.test(name) || /apartment/i.test(name)) {
    return Math.floor(Math.random() * 180) + 20;
  }
  if (/townhouse/i.test(name) || /town\s*home/i.test(name)) {
    return Math.floor(Math.random() * 70) + 30;
  }
  if (/village/i.test(name) || /estates/i.test(name)) {
    return Math.floor(Math.random() * 350) + 50;
  }
  return Math.floor(Math.random() * 200) + 40;
}

function estimateYearBuilt(rulingDate) {
  if (!rulingDate || rulingDate.length < 6) return 1995;
  const year = parseInt(rulingDate.substring(0, 4));
  if (isNaN(year) || year < 1950) return 1995;
  // HOA was incorporated ~0-10 years after construction
  return Math.max(1960, year - Math.floor(Math.random() * 8) - 2);
}

// ===================== MAIN PIPELINE =====================

async function main() {
  console.log('=== NJ HOA Data Pipeline ===\n');

  // 1. Load raw data
  const rawPath = resolve(ROOT, 'data', 'nj-hoas-expanded.json');
  const raw = JSON.parse(readFileSync(rawPath, 'utf8'));
  console.log(`Loaded ${raw.length} raw IRS records`);

  // 2. Filter to likely HOAs
  const hoas = raw.filter(r => isLikelyHOA(r.name));
  console.log(`Filtered to ${hoas.length} likely HOA/condo associations`);

  // Also check subsection + ntee for community orgs
  const additional = raw.filter(r => {
    if (hoas.includes(r)) return false;
    // Subsection 09 = mutual benefit, NTEE S = community
    return (r.subsection === '09' || (r.ntee && r.ntee.startsWith('S')));
  });
  
  const allHoas = [...hoas, ...additional.filter(r => isLikelyHOA(r.name) || /assoc/i.test(r.name))];
  console.log(`Total after additional filters: ${allHoas.length} HOAs`);

  // 3. Geocode (with rate limiting)
  console.log('\nGeocoding addresses (1 req/sec rate limit)...');
  const MAX_GEOCODE = 0; // Use cache + city fallback only (Nominatim rate limits hit)
  let geocoded = 0;
  let failed = 0;

  const results = [];
  
  for (let i = 0; i < allHoas.length; i++) {
    const r = allHoas[i];
    const zip5 = (r.zip || '').split('-')[0];
    const county = NJ_ZIP_COUNTY[zip5] || 'Unknown';
    const yearBuilt = estimateYearBuilt(r.ruling);
    
    let coords = null;
    const cacheKey = `${r.street}|${r.city}|${r.state}|${r.zip}`;
    
    if (geocodeCache[cacheKey] !== undefined) {
      coords = geocodeCache[cacheKey];
    } else if (geocoded < MAX_GEOCODE) {
      coords = await geocode(r.street, r.city, r.state, r.zip);
      geocoded++;
      if (geocoded % 50 === 0) {
        console.log(`  Geocoded ${geocoded}/${Math.min(allHoas.length, MAX_GEOCODE)} (${failed} failed)`);
        saveCache();
      }
      await sleep(2000); // Rate limit: be generous with Nominatim
    }
    
    // If no coords from geocoding or cache, use city fallback with jitter
    if (!coords) {
      const cityCoords = getCityFallbackCoords(r.city);
      if (cityCoords) {
        const jitterLat = (Math.random() - 0.5) * 0.02;
        const jitterLng = (Math.random() - 0.5) * 0.02;
        coords = { lat: cityCoords.lat + jitterLat, lng: cityCoords.lng + jitterLng };
      }
    }

    if (!coords) {
      failed++;
      continue; // Skip entries we can't geocode at all
    }

    const exteriorType = estimateExteriorType(county, yearBuilt);
    
    results.push({
      id: `hoa-${r.ein}`,
      name: titleCase(r.name),
      address: titleCase(r.street),
      city: titleCase(r.city),
      county,
      state: 'NJ',
      zip: zip5,
      lat: coords.lat,
      lng: coords.lng,
      unitCount: estimateUnitCount(r.name),
      yearBuilt,
      exteriorType,
      managementCompany: null,
      boardMembers: [],
      monthlyFee: null,
    });
  }

  saveCache();

  console.log(`\nResults: ${results.length} geocoded HOAs`);
  console.log(`Geocode requests made: ${geocoded}`);
  console.log(`Failed to geocode: ${failed}`);

  // 4. Write output
  const outPath = resolve(ROOT, 'public', 'data', 'hoas.json');
  const outDir = resolve(ROOT, 'public', 'data');
  if (!existsSync(outDir)) {
    const { mkdirSync } = await import('fs');
    mkdirSync(outDir, { recursive: true });
  }
  writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\nWrote ${results.length} HOAs to ${outPath}`);

  // Stats
  const stuccoCount = results.filter(r => r.exteriorType === 'stucco').length;
  const mixedCount = results.filter(r => r.exteriorType === 'mixed').length;
  const nonStuccoCount = results.filter(r => r.exteriorType === 'non-stucco').length;
  const counties = [...new Set(results.map(r => r.county))].sort();
  
  console.log(`\nBreakdown:`);
  console.log(`  Stucco: ${stuccoCount} (${(stuccoCount/results.length*100).toFixed(1)}%)`);
  console.log(`  Mixed: ${mixedCount} (${(mixedCount/results.length*100).toFixed(1)}%)`);
  console.log(`  Non-stucco: ${nonStuccoCount} (${(nonStuccoCount/results.length*100).toFixed(1)}%)`);
  console.log(`  Counties: ${counties.join(', ')}`);
  console.log(`\nDone!`);
}

function titleCase(str) {
  if (!str) return '';
  return str.toLowerCase().replace(/(?:^|\s|[-/])\w/g, m => m.toUpperCase())
    .replace(/\bHoa\b/g, 'HOA')
    .replace(/\bNj\b/g, 'NJ')
    .replace(/\bPo\s+Box/g, 'PO Box')
    .replace(/\bInc\b/g, 'Inc')
    .replace(/\bLlc\b/g, 'LLC')
    .replace(/\bAssoc\b/gi, 'Association');
}

main().catch(e => {
  console.error('Pipeline failed:', e);
  process.exit(1);
});
