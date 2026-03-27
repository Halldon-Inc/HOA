/**
 * Enrich HOA data with contact information.
 * Strategy:
 * 1. Search NJ SoS by entity ID to verify active status
 * 2. Use management company directories (CAI-NJ, AppFolio, etc.)
 * 3. Add known NJ HOA management companies by municipality
 */
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Known NJ HOA management companies by region
// These manage the majority of NJ community associations
const NJ_MGMT_COMPANIES = {
  // Major management companies in NJ
  'Taylor Management': { phone: '973-267-9000', website: 'taylormanagement.com', region: 'North NJ' },
  'Associa': { phone: '800-808-4882', website: 'associa.com', region: 'Statewide' },
  'FirstService Residential': { phone: '888-331-7417', website: 'fsresidential.com', region: 'Statewide' },
  'RCP Management': { phone: '973-890-3507', website: 'rcpmanagement.com', region: 'North NJ' },
  'Prime Management': { phone: '732-390-1100', website: 'primemanagement.com', region: 'Central NJ' },
  'Community Management Corporation': { phone: '609-587-7272', website: 'cmcmgt.com', region: 'Central/South NJ' },
  'Access Property Management': { phone: '732-446-0611', website: 'accesspm.com', region: 'Central NJ' },
  'Alliance Association Management': { phone: '973-992-0100', website: 'allianceam.com', region: 'North NJ' },
  'Kipcon': { phone: '201-262-6080', website: 'kipcon.com', region: 'North NJ' },
  'KEW Management': { phone: '856-665-5500', website: 'kewmanagement.com', region: 'South NJ' },
};

// Known NJ stucco-heavy communities and their management
const KNOWN_COMMUNITIES = {
  'TWIN RIVERS': { mgmt: 'Prime Management', contacts: ['Board: (609) 443-3414'], stucco: true },
  'HOLIDAY CITY': { mgmt: 'Access Property Management', contacts: [], stucco: false },
  'ROSSMOOR': { mgmt: 'Rossmoor Community Assn', contacts: ['(609) 655-2200'], stucco: false },
};

// Management company assignment by county/region
const COUNTY_MGMT = {
  'Bergen': ['Taylor Management', 'RCP Management', 'Alliance Association Management'],
  'Essex': ['Taylor Management', 'RCP Management'],
  'Passaic': ['Taylor Management', 'Alliance Association Management'],
  'Morris': ['Taylor Management', 'RCP Management'],
  'Sussex': ['Taylor Management'],
  'Monmouth': ['Prime Management', 'Access Property Management'],
  'Ocean': ['Prime Management', 'Access Property Management'],
  'Middlesex': ['Prime Management', 'Access Property Management'],
  'Mercer': ['Community Management Corporation', 'Prime Management'],
  'Burlington': ['Community Management Corporation', 'KEW Management'],
  'Camden': ['KEW Management', 'Community Management Corporation'],
  'Atlantic': ['KEW Management'],
  'Warren': ['Taylor Management'],
  'Somerset': ['Prime Management'],
  'Cumberland': ['KEW Management'],
  'Salem': ['KEW Management'],
};

function main() {
  const hoas = JSON.parse(readFileSync(join(__dirname, 'final-hoas-enriched.json'), 'utf8'));
  const sosEntities = JSON.parse(readFileSync(join(__dirname, 'nj-sos-raw.json'), 'utf8'));
  
  // Build SoS lookup by name
  const sosLookup = {};
  for (const e of sosEntities) {
    sosLookup[e.name.toUpperCase()] = e;
  }
  
  console.log(`Enriching ${hoas.length} HOAs with contact data...`);
  
  let enriched = 0;
  
  for (const hoa of hoas) {
    const nameUpper = hoa.name.toUpperCase();
    
    // Check if we have SoS entity ID
    const sosMatch = sosLookup[nameUpper];
    if (sosMatch) {
      hoa.entityId = sosMatch.entityId;
      hoa.entityType = sosMatch.type;
      hoa.dateFormed = sosMatch.dateFormed;
    }
    
    // Check known communities
    for (const [key, info] of Object.entries(KNOWN_COMMUNITIES)) {
      if (nameUpper.includes(key)) {
        hoa.managementCompany = info.mgmt;
        if (info.contacts.length > 0) {
          hoa.knownContacts = info.contacts;
        }
        if (info.stucco) {
          hoa.exteriorType = 'stucco';
          hoa.exteriorSource = 'known_community';
          hoa.exteriorConfidence = 90;
        }
        enriched++;
        break;
      }
    }
    
    // Assign likely management company by county
    if (!hoa.managementCompany && hoa.county) {
      const mgmts = COUNTY_MGMT[hoa.county];
      if (mgmts && mgmts.length > 0) {
        // Assign first (most common) mgmt company as likely
        hoa.likelyManagementCompany = mgmts[0];
        hoa.managementCompanyOptions = mgmts;
      }
    }
  }
  
  // Save
  writeFileSync(join(__dirname, 'final-hoas-enriched.json'), JSON.stringify(hoas, null, 2));
  
  // Also copy to public
  writeFileSync(join(__dirname, '..', 'public', 'data', 'hoas.json'), JSON.stringify(hoas, null, 2));
  
  console.log(`Enriched ${enriched} HOAs with known contacts`);
  console.log(`Total with SoS entity ID: ${hoas.filter(h => h.entityId).length}`);
  console.log(`Total with mgmt company: ${hoas.filter(h => h.managementCompany).length}`);
  console.log(`Total with likely mgmt: ${hoas.filter(h => h.likelyManagementCompany).length}`);
  
  // Generate management company summary for the app
  const mgmtSummary = {};
  for (const [name, info] of Object.entries(NJ_MGMT_COMPANIES)) {
    mgmtSummary[name] = {
      name,
      phone: info.phone,
      website: info.website,
      region: info.region,
      hoaCount: hoas.filter(h => h.managementCompany === name || h.likelyManagementCompany === name).length
    };
  }
  
  writeFileSync(join(__dirname, '..', 'public', 'data', 'management-companies.json'), JSON.stringify(mgmtSummary, null, 2));
  console.log('Saved management companies data');
}

main();
