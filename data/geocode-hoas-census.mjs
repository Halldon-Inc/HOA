/**
 * Geocode 1595 HOA entities using multiple strategies:
 * 1. Extract street address from entity name (many contain addresses)
 * 2. Use city name + "NJ" for city-level geocoding via Nominatim
 * 3. Use Census Bureau geocoder for exact addresses
 * 
 * Cache results aggressively.
 */
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INPUT_FILE = join(__dirname, 'sos-keyword-results.json');
const CACHE_FILE = join(__dirname, 'geocode-cache-v2.json');
const OUTPUT_FILE = join(__dirname, 'sos-hoas-geocoded.json');

const sleep = ms => new Promise(r => setTimeout(r, ms));

// NJ municipality coordinates (pre-computed for fast lookup)
const NJ_CITIES = {};

// Census geocoder
async function geocodeCensus(address, city, state = 'NJ') {
  const query = `${address}, ${city}, ${state}`;
  const url = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(query)}&benchmark=Public_AR_Current&format=json`;
  
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const data = await resp.json();
    const matches = data?.result?.addressMatches;
    if (matches && matches.length > 0) {
      return {
        lat: matches[0].coordinates.y,
        lng: matches[0].coordinates.x,
        source: 'census',
        matchedAddress: matches[0].matchedAddress,
      };
    }
  } catch (e) { /* ignore */ }
  return null;
}

// Nominatim geocoder (rate limited)
async function geocodeNominatim(query) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&countrycodes=us&limit=1`;
  
  try {
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: { 'User-Agent': 'NJHOAMap/1.0' }
    });
    const data = await resp.json();
    if (data.length > 0) {
      return {
        lat: parseFloat(data[0].lat),
        lng: parseFloat(data[0].lon),
        source: 'nominatim',
        matchedAddress: data[0].display_name,
      };
    }
  } catch (e) { /* ignore */ }
  return null;
}

// Extract address from entity name
function extractAddress(name) {
  // Match patterns like "123 MAIN STREET" at the start of names
  const match = name.match(/^(\d+[\-\d]*\s+[\w\s]+(?:STREET|ST|AVENUE|AVE|ROAD|RD|DRIVE|DR|LANE|LN|COURT|CT|PLACE|PL|BOULEVARD|BLVD|WAY|CIRCLE|CIR|TERRACE|TER|PIKE|HIGHWAY|HWY))/i);
  if (match) return match[1].trim();
  
  // Match "AT 123 MAIN ST" patterns
  const atMatch = name.match(/AT\s+(\d+[\-\d]*\s+[\w\s]+(?:STREET|ST|AVENUE|AVE|ROAD|RD|DRIVE|DR|LANE|LN|COURT|CT|PLACE|PL|BOULEVARD|BLVD|WAY|CIRCLE|CIR))/i);
  if (atMatch) return atMatch[1].trim();
  
  return null;
}

// Extract community/development name for geocoding
function extractCommunityName(name) {
  // Remove common suffixes
  let clean = name
    .replace(/\s*(HOMEOWNERS?|HOME OWNERS?|CONDOMINIUM|CONDO|PROPERTY OWNERS?|COMMUNITY|CIVIC)\s*(ASSOCIATION|ASSOC|CORP|INC|LLC|OF|AT|A NJ NONPROFIT CORPORATION).*$/i, '')
    .trim();
  
  return clean;
}

async function main() {
  const hoas = JSON.parse(readFileSync(INPUT_FILE, 'utf8'));
  console.log(`HOAs to geocode: ${hoas.length}`);
  
  // Load cache
  let cache = {};
  if (existsSync(CACHE_FILE)) {
    cache = JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
    console.log(`Cache: ${Object.keys(cache).length} entries`);
  }
  
  let geocoded = 0;
  let failed = 0;
  let cached = 0;
  
  for (let i = 0; i < hoas.length; i++) {
    const hoa = hoas[i];
    const cacheKey = hoa.entityId || hoa.name;
    
    if (cache[cacheKey]) {
      const c = cache[cacheKey];
      if (c.lat) {
        hoa.lat = c.lat;
        hoa.lng = c.lng;
        hoa.geoSource = c.source;
        geocoded++;
      } else {
        failed++;
      }
      cached++;
      continue;
    }
    
    if ((i + 1) % 50 === 0) {
      console.log(`[${i+1}/${hoas.length}] geocoded: ${geocoded}, failed: ${failed}`);
    }
    
    // Strategy 1: Extract address from name
    const address = extractAddress(hoa.name);
    const city = hoa.city || '';
    
    if (address && city) {
      const result = await geocodeCensus(address, city);
      if (result) {
        hoa.lat = result.lat;
        hoa.lng = result.lng;
        hoa.geoSource = 'census_address';
        cache[cacheKey] = result;
        geocoded++;
        continue;
      }
    }
    
    // Strategy 2: Geocode city, NJ (city-level)
    if (city) {
      const cityKey = `city:${city.toUpperCase()}`;
      if (cache[cityKey]) {
        if (cache[cityKey].lat) {
          hoa.lat = cache[cityKey].lat;
          hoa.lng = cache[cityKey].lng;
          hoa.geoSource = 'city_center';
          geocoded++;
        } else {
          failed++;
        }
        cache[cacheKey] = cache[cityKey];
        continue;
      }
      
      // Use Nominatim for city-level (slower, rate limited)
      const result = await geocodeNominatim(`${city}, New Jersey, USA`);
      if (result) {
        // Add small random offset so markers don't stack
        const offset = () => (Math.random() - 0.5) * 0.01;
        hoa.lat = result.lat + offset();
        hoa.lng = result.lng + offset();
        hoa.geoSource = 'city_center';
        cache[cityKey] = result;
        cache[cacheKey] = { ...result, lat: hoa.lat, lng: hoa.lng };
        geocoded++;
        await sleep(1100); // Nominatim rate limit: 1 req/sec
        continue;
      } else {
        cache[cityKey] = { lat: null, lng: null, source: 'failed' };
        await sleep(1100);
      }
    }
    
    // Strategy 3: Try community name + NJ
    const community = extractCommunityName(hoa.name);
    if (community && community.length > 3) {
      const result = await geocodeNominatim(`${community}, New Jersey, USA`);
      if (result && result.lat > 38.5 && result.lat < 41.5 && result.lng > -75.6 && result.lng < -73.8) {
        const offset = () => (Math.random() - 0.5) * 0.01;
        hoa.lat = result.lat + offset();
        hoa.lng = result.lng + offset();
        hoa.geoSource = 'community_name';
        cache[cacheKey] = { ...result, lat: hoa.lat, lng: hoa.lng };
        geocoded++;
        await sleep(1100);
        continue;
      }
      await sleep(1100);
    }
    
    cache[cacheKey] = { lat: null, lng: null, source: 'failed' };
    failed++;
    
    // Save cache periodically
    if ((i + 1) % 25 === 0) {
      writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
    }
  }
  
  // Final save
  writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  
  // Filter to geocoded only
  const geocodedHoas = hoas.filter(h => h.lat && h.lng);
  
  console.log(`\nResults:`);
  console.log(`  Total: ${hoas.length}`);
  console.log(`  Geocoded: ${geocodedHoas.length}`);
  console.log(`  Failed: ${hoas.length - geocodedHoas.length}`);
  console.log(`  From cache: ${cached}`);
  
  // Format for map
  const mapData = geocodedHoas.map(h => ({
    name: h.name,
    municipality: h.city || '',
    county: '', // SoS doesn't give county
    entityId: h.entityId || '',
    entityType: h.type || '',
    dateFormed: h.dateFormed || '',
    lat: h.lat,
    lng: h.lng,
    geoSource: h.geoSource || 'unknown',
    parcelCount: 0,
    exteriorType: 'unknown',
    yearBuilt: null,
    address: '',
    buildingDesc: '',
  }));
  
  writeFileSync(OUTPUT_FILE, JSON.stringify(mapData, null, 2));
  console.log(`\nSaved ${mapData.length} geocoded HOAs to ${OUTPUT_FILE}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
