#!/usr/bin/env node
// Extract HOA/Condo associations from IRS EO BMF NJ data
const fs = require('fs');
const path = require('path');

const csv = fs.readFileSync(path.join(__dirname, 'raw/eo_nj.csv'), 'utf-8');
const lines = csv.split('\n');
const header = lines[0].split(',');

// IRS subsection codes: 04 = 501(c)(4), 07 = 501(c)(7)
// These are the most common for HOAs
const HOA_SUBSECTIONS = ['04', '07'];

// Strong HOA indicators (high confidence)
const STRONG_PATTERNS = [
  /homeowner/i, /home\s*owner/i, /\bh\.?o\.?a\.?\b/i,
  /condominium/i, /condo\s*assoc/i, /condo\s*owners/i,
  /property\s*owner/i, /townhome/i, /townhouse/i,
  /community\s*assoc/i, /civic\s*assoc/i,
  /\bcommon\s*interest/i, /\bplanned\s*community/i,
  /\bunit\s*owner/i, /\bco-?op/i,
  /maintenance\s*corp/i, /maintenance\s*assoc/i
];

// Name patterns typical of HOA communities (used with subsection filter)
const COMMUNITY_PATTERNS = [
  /village\s*(at|of|on)/i, /estates\s*(at|of|on|assoc|inc|home)/i,
  /\bmanor\b.*\b(assoc|inc|corp|club)\b/i,
  /\bcommons\b.*\b(assoc|inc|corp)\b/i,
  /\bgardens\b.*\b(assoc|inc|corp)\b/i,
  /\bterrace\b.*\b(assoc|inc|corp)\b/i,
  /\bridge\b.*\b(assoc|inc|corp)\b/i,
  /\bmeadow/i, /\bcreek\b.*assoc/i,
  /\blake\b.*\b(assoc|inc|corp)\b/i,
  /\bwoods\b.*\b(assoc|inc|corp)\b/i,
  /\bglen\b.*\b(assoc|inc|corp)\b/i,
  /\bheights\b.*\b(assoc|inc|corp)\b/i,
  /\blanding\b.*\b(assoc|inc|corp)\b/i,
  /\bcrossing\b.*\b(assoc|inc|corp)\b/i,
  /\bgrove\b.*\b(assoc|inc|corp)\b/i,
  /\bhollow\b.*\b(assoc|inc|corp)\b/i,
  /\brun\b.*\b(assoc|inc|corp)\b/i,
  /\bchase\b.*\b(assoc|inc|corp)\b/i,
  /\bpointe?\b.*\b(assoc|inc|corp)\b/i
];

// Exclusion patterns (not HOAs)
const EXCLUDE_PATTERNS = [
  /\bchurch\b/i, /\btemple\b/i, /\bmosque\b/i, /\bsynagogue\b/i,
  /\bfoundation\b/i, /\bunion\b/i, /\bsociety\b/i,
  /\blocal\s*\d/i, /\bvfw\b/i, /\belks\b/i, /\bmoose\b/i,
  /\brotary\b/i, /\blions\b/i, /\bkiwanis\b/i,
  /\bfire\s*(dept|company|district)/i, /\bambulance/i,
  /\brescue\b/i, /\bmuseum\b/i, /\blibrary\b/i,
  /\bscout/i, /\byouth\b/i, /\blittle\s*league/i,
  /\bschool\b/i, /\beducation/i, /\bacademy\b/i,
  /\bhospital\b/i, /\bmedical\b/i, /\bclinic\b/i,
  /\bdemocrat/i, /\brepublican/i, /\bpolitical/i,
  /\bcountry\s*club\b/i, /\bgolf/i, /\bswim\s*club/i,
  /\byacht/i, /\bboat\s*club/i, /\btennis/i,
  /\bcharity\b/i, /\bhumanitarian/i,
  /\bveterans?\b/i, /\bmilitary\b/i, /\bamerican\s*legion/i,
  /\bfraternal/i, /\bsorority\b/i, /\bfraternity\b/i,
  /\blodge\b/i, /\border\s*of\b/i,
  /\banimal/i, /\bwildlife/i, /\bhumane\b/i,
  /\barts?\b/i, /\btheater\b/i, /\bmusic\b/i,
  /\bathletic/i, /\bbaseball\b/i, /\bsoccer\b/i, /\bfootball\b/i,
  /\bhistoric/i, /\bpreservation/i
];

const hoas = [];
const seen = new Set();

for (let i = 1; i < lines.length; i++) {
  const line = lines[i];
  if (!line.trim()) continue;
  
  // Parse CSV (simple, IRS data doesn't have quoted commas)
  const fields = line.split(',');
  const ein = fields[0];
  const name = fields[1];
  const street = fields[3];
  const city = fields[4];
  const state = fields[5];
  const zip = fields[6];
  const subsection = fields[8];
  const status = fields[16];
  
  // Only active NJ orgs
  if (state !== 'NJ' && state !== ' NJ') continue;
  // Status 01 = unconditional exemption (active)
  
  // Skip if not relevant subsection
  if (!HOA_SUBSECTIONS.includes(subsection)) continue;
  
  // Check for exclusions first
  if (EXCLUDE_PATTERNS.some(p => p.test(name))) continue;
  
  // Check strong patterns
  const isStrongMatch = STRONG_PATTERNS.some(p => p.test(name));
  
  // Check community patterns (only for c(4) and c(7))
  const isCommunityMatch = COMMUNITY_PATTERNS.some(p => p.test(name));
  
  if (isStrongMatch || isCommunityMatch) {
    const key = `${ein}-${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    
    hoas.push({
      ein,
      name: name.trim(),
      street: street.trim(),
      city: city.trim(),
      state: 'NJ',
      zip: zip.trim().substring(0, 5),
      subsection,
      confidence: isStrongMatch ? 'high' : 'medium',
      status: status.trim()
    });
  }
}

// Sort by confidence then name
hoas.sort((a, b) => {
  if (a.confidence !== b.confidence) return a.confidence === 'high' ? -1 : 1;
  return a.name.localeCompare(b.name);
});

console.log(`Total HOAs found: ${hoas.length}`);
console.log(`High confidence: ${hoas.filter(h => h.confidence === 'high').length}`);
console.log(`Medium confidence: ${hoas.filter(h => h.confidence === 'medium').length}`);
console.log(`\nSample high confidence:`);
hoas.filter(h => h.confidence === 'high').slice(0, 20).forEach(h => {
  console.log(`  ${h.name} | ${h.city}, NJ ${h.zip} | ${h.street}`);
});
console.log(`\nSample medium confidence:`);
hoas.filter(h => h.confidence === 'medium').slice(0, 20).forEach(h => {
  console.log(`  ${h.name} | ${h.city}, NJ ${h.zip} | ${h.street}`);
});

// Write output
fs.writeFileSync(path.join(__dirname, 'nj-hoas-irs.json'), JSON.stringify(hoas, null, 2));
console.log(`\nWritten to data/nj-hoas-irs.json`);
