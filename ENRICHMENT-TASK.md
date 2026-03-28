# HOA Parcel-Level Stucco Enrichment Task

## Goal
Link 16,905 MOD-IV condo parcels and 7,537 MOD-IV stucco-confirmed parcels back to their parent HOAs to get CONFIRMED building-level stucco classifications.

## Current State
- `public/data/hoas.json`: 5,244 HOAs (2,297 stucco, 1,713 mixed, 1,234 non-stucco) but most stucco are ZIP-density ASSUMPTIONS, not confirmed
- `data/modiv-condos.json`: 16,905 condo parcels (503 have FAC_NAME = HOA name)
- `data/modiv-stucco-confirmed.json`: 7,537 stucco parcels (confirmed by BLDG_DESC containing STCO/STUC)
- HOA data has: name, municipality, county, lat/lng, address
- MOD-IV data has: PROP_LOC (address), BLDG_DESC, COUNTY, MUN_NAME, ZIP5, FAC_NAME

## Approach (3 Phases)

### Phase 1: Direct FAC_NAME Matching
- 503 condos have FAC_NAME (facility/HOA name)
- Fuzzy-match FAC_NAME to HOA names in hoas.json
- This gives direct parcel-to-HOA links

### Phase 2: Geographic Clustering
- For condos WITHOUT FAC_NAME, cluster by:
  1. Same municipality + same ZIP
  2. Street name matching (extract street name from PROP_LOC, match to HOA address)
  3. Geographic proximity (HOAs have lat/lng, parcels have addresses)
- Group condos into clusters that likely belong to the same HOA

### Phase 3: Stucco Cross-Reference
- Take the 7,537 stucco-confirmed parcels
- Match them to the same municipality/ZIP/street clusters
- For each HOA, count: total linked parcels, stucco parcels, non-stucco parcels
- Calculate stucco percentage
- Reclassify: >50% stucco = "stucco", 10-50% = "mixed", <10% = "non-stucco"
- This replaces the ZIP-density assumptions with actual parcel data

## Municipality Name Matching
HOA data uses: "Lawrence Township", "Haddonfield", "lakewood"
MOD-IV uses: "MILLVILLE CITY", "GLOUCESTER TWP", "EDISON TWP"
Need fuzzy matching that handles: TWP/Township, CITY suffix, case, abbreviations

## Output
Write enriched data to `public/data/hoas.json` with updated:
- `exteriorType`: now based on actual parcel matching
- `stuccoConfirmed`: number of confirmed stucco parcels
- `totalParcels`: total linked parcels
- `stuccoPercentage`: percentage
- `matchMethod`: "fac_name" | "geographic" | "zip_density" (for transparency)

Also write `data/parcel-hoa-links.json` with the individual parcel-to-HOA mappings.

## Important
- Push results to Halldon-Inc/HOA repo when done
- Be honest about confidence levels
- Preserve all existing HOA data, just add/update the exterior classification fields
