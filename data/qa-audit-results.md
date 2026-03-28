# QA Audit Results
Generated: 2026-03-28 01:34

## Issue Fixed
`stucco_confirmed` was `null` for all 16,905 records. Now derived from `stucco_classification`:

| Classification | stucco_confirmed | Count |
|---|---|---|
| confirmed-stucco | stucco | 15 |
| mixed-materials | mixed | 161 |
| brick | non-stucco | 6217 |
| frame | non-stucco | 4424 |
| concrete-block | non-stucco | 378 |
| apartment-generic | unknown | 3348 |
| unknown | unknown | 2362 |

## stucco_confirmed Summary
| Status | Count | % |
|---|---|---|
| stucco | 15 | 0.1% |
| mixed | 161 | 1.0% |
| non-stucco | 11019 | 65.2% |
| unknown | 5710 | 33.8% |

## HOA Match Stats
- Total parcels: 16905
- Matched to HOA: 2693 (15.9%)
- Unmatched: 14212

### Match Methods
- none: 14212
- street_match: 2682
- proximity: 9
- substring: 2

## Phantom Match Check
- Proximity-based matches (potential cross-municipality): 9
- These have lower confidence scores and should be verified manually

## Duplicate Check
- Duplicate parcel_index: 0 (should be 0)
- Duplicate PROP_LOC+MUN_NAME: 139 (may be legitimate - multiple units at same address)

### Sample Duplicate Locations
- ('BTWN COTTAGE&BELMONT AVES', 'BRIDGETON CITY'): 2 records
- ('DAVEY ST ETC', 'BLOOMFIELD TWP'): 2 records
- ('LINN DRIVE', 'VERONA TWP'): 4 records
- ('71 SKILLMAN AVE.', 'JERSEY CITY CITY'): 3 records
- ('42 BROADWAY', 'JERSEY CITY CITY'): 2 records
- ('62    WALL ST', 'PASSAIC CITY'): 2 records
- ('SALISBURY RD', 'WAYNE TWP'): 2 records
- ('OVERMOUNT AVE', 'WOODLAND PARK BORO'): 2 records
- ('TRAPHAGEN RD & VALLEY RD', 'WAYNE TWP'): 2 records
- ('FALCON ROAD', 'HILLSBOROUGH TWP'): 2 records
