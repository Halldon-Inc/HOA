#!/usr/bin/env python3
"""
HOA Parcel-Level Stucco Enrichment Script
==========================================
Phase 1: Fuzzy-match FAC_NAME condos to HOA names
Phase 2: Geographic clustering (municipality + ZIP + street) to link remaining condos
Phase 3: Cross-reference stucco-confirmed parcels to HOA clusters, compute percentages

Outputs:
  - public/data/hoas.json (enriched with stucco confirmation data)
  - data/parcel-hoa-links.json (individual parcel-to-HOA mappings)
"""

import json
import re
import os
from collections import defaultdict
from difflib import SequenceMatcher

# ─── Paths ───────────────────────────────────────────────────────────────────
BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOA_PATH = os.path.join(BASE, "public", "data", "hoas.json")
CONDOS_PATH = os.path.join(BASE, "data", "modiv-condos.json")
STUCCO_PATH = os.path.join(BASE, "data", "modiv-stucco-confirmed.json")
OUTPUT_LINKS = os.path.join(BASE, "data", "parcel-hoa-links.json")


def load_json(path):
    with open(path, "r") as f:
        return json.load(f)


def save_json(path, data):
    with open(path, "w") as f:
        json.dump(data, f, indent=2)
    print(f"  Wrote {path} ({len(data)} records)")


# ─── Municipality Normalization ──────────────────────────────────────────────
SUFFIX_MAP = {
    "TWP": "TOWNSHIP",
    "BORO": "BOROUGH",
    "CITY": "",
    "VILLAGE": "VILLAGE",
}

def normalize_municipality(name):
    """Normalize municipality names for matching.
    'GLOUCESTER TWP' -> 'GLOUCESTER TOWNSHIP'
    'MILLVILLE CITY' -> 'MILLVILLE'
    'Edison TWP' -> 'EDISON TOWNSHIP'
    'Lawrence Township' -> 'LAWRENCE TOWNSHIP'
    """
    if not name:
        return ""
    s = name.strip().upper()
    # Remove extra whitespace
    s = re.sub(r"\s+", " ", s)

    # Handle known suffixes
    for suffix, replacement in SUFFIX_MAP.items():
        pattern = r"\b" + suffix + r"$"
        if re.search(pattern, s):
            s = re.sub(pattern, replacement, s).strip()
            break

    return s


def extract_street_name(address):
    """Extract the main street name from an address for matching.
    '123 MAIN ST' -> 'MAIN'
    '2-6 EAST AVE & LOT' -> 'EAST'
    '45 OAK TREE RD APT 2' -> 'OAK TREE'
    """
    if not address:
        return ""
    s = address.strip().upper()
    # Remove unit/apt suffixes
    s = re.sub(r"\s*(APT|UNIT|STE|SUITE|FL|FLOOR|#)\s*\S*$", "", s)
    # Remove '& LOT' and similar
    s = re.sub(r"\s*&\s*\w+$", "", s)
    # Remove leading numbers and dashes (house number)
    s = re.sub(r"^[\d\-/]+\s*", "", s)
    # Remove trailing street type suffixes
    s = re.sub(
        r"\s+(ST|STREET|AVE|AVENUE|BLVD|BOULEVARD|RD|ROAD|DR|DRIVE|LN|LANE|CT|COURT|PL|PLACE|WAY|CIR|CIRCLE|TER|TERRACE|PKWY|PARKWAY|HWY|HIGHWAY|TRL|TRAIL|SQ|SQUARE|LOOP|RUN|PATH|PIKE|TURNPIKE)\.?$",
        "",
        s,
    )
    return s.strip()


def fuzzy_match_score(a, b):
    """Compute similarity ratio between two strings."""
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a.upper(), b.upper()).ratio()


# ─── Phase 1: FAC_NAME Matching ─────────────────────────────────────────────
def phase1_fac_name_matching(hoas, condos):
    """Match condos with FAC_NAME to HOAs via fuzzy name matching."""
    print("\n=== PHASE 1: FAC_NAME Matching ===")

    named_condos = [c for c in condos if c.get("FAC_NAME") and len(c["FAC_NAME"].strip()) > 3]
    # Filter to FAC_NAMEs that look like real names (not unit counts, building codes)
    named_condos = [
        c for c in named_condos
        if any(ch.isalpha() for ch in c["FAC_NAME"])
        and not c["FAC_NAME"].strip().startswith("(")
        and not re.match(r"^\d+[\s\-]*(UNIT|APT|BR|BD)", c["FAC_NAME"].upper())
    ]
    print(f"  Condos with plausible FAC_NAME: {len(named_condos)}")

    # Build HOA lookup by normalized municipality
    hoa_by_muni = defaultdict(list)
    for i, h in enumerate(hoas):
        norm = normalize_municipality(h.get("municipality", ""))
        hoa_by_muni[norm].append(i)
        # Also index by county
        county = (h.get("county", "") or "").upper()
        hoa_by_muni[f"COUNTY:{county}"].append(i)

    links = []
    matched_count = 0

    for condo in named_condos:
        fac = condo["FAC_NAME"].strip()
        condo_muni = normalize_municipality(condo.get("MUN_NAME", ""))
        condo_county = (condo.get("COUNTY", "") or "").upper()

        # Search candidates: same municipality first, then same county
        candidate_indices = set()
        candidate_indices.update(hoa_by_muni.get(condo_muni, []))
        candidate_indices.update(hoa_by_muni.get(f"COUNTY:{condo_county}", []))

        best_score = 0
        best_hoa_idx = None

        for idx in candidate_indices:
            h = hoas[idx]
            hoa_name = h.get("name", "")
            # Try matching FAC_NAME against HOA name
            score = fuzzy_match_score(fac, hoa_name)

            # Also try matching against just the HOA name prefix (before "HOMEOWNERS" etc)
            short_name = re.sub(
                r"\s*(HOMEOWNERS?|HOA|ASSOCIATION|INC\.?|LLC|CORP|A NJ NONPROFIT CORPORATION|CONDOMINIUM|CONDO|CO-OP)\b.*",
                "",
                hoa_name.upper(),
            ).strip()
            score2 = fuzzy_match_score(fac.upper(), short_name)
            score = max(score, score2)

            if score > best_score:
                best_score = score
                best_hoa_idx = idx

        if best_score >= 0.55 and best_hoa_idx is not None:
            links.append({
                "parcel_address": condo["PROP_LOC"],
                "parcel_muni": condo["MUN_NAME"],
                "parcel_zip": condo["ZIP5"],
                "fac_name": fac,
                "hoa_id": hoas[best_hoa_idx].get("entityId", str(best_hoa_idx)),
                "hoa_name": hoas[best_hoa_idx]["name"],
                "match_method": "fac_name",
                "match_score": round(best_score, 3),
            })
            matched_count += 1

    print(f"  FAC_NAME matches found: {matched_count}")
    return links


# ─── Phase 2: Geographic Clustering ─────────────────────────────────────────
def phase2_geographic_matching(hoas, condos, existing_links):
    """Match condos without FAC_NAME to HOAs by municipality+ZIP+street."""
    print("\n=== PHASE 2: Geographic Clustering ===")

    # Track already-linked parcels
    linked_keys = set()
    for link in existing_links:
        linked_keys.add((link["parcel_address"], link["parcel_muni"], link["parcel_zip"]))

    # Build HOA index by normalized municipality + ZIP
    hoa_by_muni_zip = defaultdict(list)
    hoa_by_muni = defaultdict(list)
    for i, h in enumerate(hoas):
        norm_muni = normalize_municipality(h.get("municipality", ""))
        addr = (h.get("address", "") or "").upper()
        zip_code = ""
        # Extract ZIP from HOA address if available
        zip_match = re.search(r"\b(\d{5})\b", h.get("zip", "") if h.get("zip") else "")
        # HOAs might not have ZIP, but we can match by municipality alone
        hoa_by_muni[norm_muni].append(i)

    # Build HOA street name index: (norm_muni) -> {street_name: [hoa_indices]}
    hoa_streets = defaultdict(lambda: defaultdict(list))
    for i, h in enumerate(hoas):
        norm_muni = normalize_municipality(h.get("municipality", ""))
        street = extract_street_name(h.get("address", ""))
        if street:
            hoa_streets[norm_muni][street].append(i)

    links = []
    matched = 0
    unmatched = 0

    for condo in condos:
        key = (condo["PROP_LOC"], condo["MUN_NAME"], condo["ZIP5"])
        if key in linked_keys:
            continue

        condo_muni = normalize_municipality(condo.get("MUN_NAME", ""))
        condo_street = extract_street_name(condo.get("PROP_LOC", ""))
        condo_zip = condo.get("ZIP5", "")

        # Strategy 1: Match by municipality + street name
        best_hoa_idx = None
        best_score = 0
        match_detail = ""

        if condo_street and condo_muni in hoa_streets:
            street_hoas = hoa_streets[condo_muni]
            # Exact street match
            if condo_street in street_hoas:
                # Multiple HOAs on same street - pick closest by address number
                candidates = street_hoas[condo_street]
                if len(candidates) == 1:
                    best_hoa_idx = candidates[0]
                    best_score = 0.9
                    match_detail = "street_exact"
                else:
                    # Pick the one with closest address number
                    condo_num = re.match(r"^(\d+)", condo.get("PROP_LOC", "") or "")
                    condo_num = int(condo_num.group(1)) if condo_num else 0
                    closest_dist = float("inf")
                    for idx in candidates:
                        hoa_num = re.match(r"^(\d+)", hoas[idx].get("address", "") or "")
                        hoa_num = int(hoa_num.group(1)) if hoa_num else 0
                        dist = abs(condo_num - hoa_num)
                        if dist < closest_dist:
                            closest_dist = dist
                            best_hoa_idx = idx
                    best_score = 0.85
                    match_detail = "street_closest"
            else:
                # Fuzzy street match
                for street, indices in street_hoas.items():
                    score = fuzzy_match_score(condo_street, street)
                    if score > best_score and score >= 0.7:
                        best_score = score * 0.8  # Discount fuzzy
                        best_hoa_idx = indices[0]
                        match_detail = "street_fuzzy"

        # Strategy 2: If no street match, match by municipality alone (weaker)
        if best_hoa_idx is None and condo_muni in hoa_by_muni:
            # Only use municipality match for condos (PROP_CLASS 4A/4C are condos)
            candidates = hoa_by_muni[condo_muni]
            if len(candidates) <= 5:
                # Small municipality with few HOAs - reasonable to link
                # Pick the HOA with most similar address
                for idx in candidates:
                    hoa_addr = (hoas[idx].get("address", "") or "").upper()
                    condo_addr = (condo.get("PROP_LOC", "") or "").upper()
                    score = fuzzy_match_score(condo_addr, hoa_addr)
                    if score > best_score and score >= 0.4:
                        best_score = score * 0.6  # Heavy discount for municipality-only
                        best_hoa_idx = idx
                        match_detail = "muni_address"

        if best_hoa_idx is not None:
            links.append({
                "parcel_address": condo["PROP_LOC"],
                "parcel_muni": condo["MUN_NAME"],
                "parcel_zip": condo["ZIP5"],
                "fac_name": condo.get("FAC_NAME"),
                "hoa_id": hoas[best_hoa_idx].get("entityId", str(best_hoa_idx)),
                "hoa_name": hoas[best_hoa_idx]["name"],
                "match_method": f"geographic:{match_detail}",
                "match_score": round(best_score, 3),
            })
            matched += 1
        else:
            unmatched += 1

    print(f"  Geographic matches: {matched}")
    print(f"  Unmatched condos: {unmatched}")
    return links


# ─── Phase 3: Stucco Cross-Reference ────────────────────────────────────────
def phase3_stucco_crossref(hoas, stucco_parcels, all_links):
    """Cross-reference stucco-confirmed parcels to HOAs and compute percentages."""
    print("\n=== PHASE 3: Stucco Cross-Reference ===")

    # Build HOA index by normalized municipality + street
    hoa_by_muni = defaultdict(list)
    hoa_streets = defaultdict(lambda: defaultdict(list))
    for i, h in enumerate(hoas):
        norm_muni = normalize_municipality(h.get("municipality", ""))
        hoa_by_muni[norm_muni].append(i)
        street = extract_street_name(h.get("address", ""))
        if street:
            hoa_streets[norm_muni][street].append(i)

    # Track stucco parcels linked to each HOA
    # hoa_id -> {"stucco": count, "total": count}
    hoa_stucco = defaultdict(lambda: {"stucco": 0, "total": 0})

    # First, count parcels from Phase 1+2 links
    hoa_id_map = {}  # entityId -> index
    for i, h in enumerate(hoas):
        eid = h.get("entityId", str(i))
        hoa_id_map[eid] = i

    for link in all_links:
        hoa_id = link["hoa_id"]
        hoa_stucco[hoa_id]["total"] += 1

    # Now match stucco-confirmed parcels to HOAs
    stucco_links = []
    matched = 0

    for parcel in stucco_parcels:
        parcel_muni = normalize_municipality(parcel.get("MUN_NAME", ""))
        parcel_street = extract_street_name(parcel.get("PROP_LOC", ""))
        parcel_zip = parcel.get("ZIP5", "")

        best_hoa_idx = None
        best_score = 0
        match_detail = ""

        # Match by municipality + street
        if parcel_street and parcel_muni in hoa_streets:
            street_hoas = hoa_streets[parcel_muni]
            if parcel_street in street_hoas:
                candidates = street_hoas[parcel_street]
                if len(candidates) == 1:
                    best_hoa_idx = candidates[0]
                    best_score = 0.9
                    match_detail = "stucco_street_exact"
                else:
                    parcel_num = re.match(r"^(\d+)", parcel.get("PROP_LOC", "") or "")
                    parcel_num = int(parcel_num.group(1)) if parcel_num else 0
                    closest_dist = float("inf")
                    for idx in candidates:
                        hoa_num = re.match(r"^(\d+)", hoas[idx].get("address", "") or "")
                        hoa_num = int(hoa_num.group(1)) if hoa_num else 0
                        dist = abs(parcel_num - hoa_num)
                        if dist < closest_dist:
                            closest_dist = dist
                            best_hoa_idx = idx
                    best_score = 0.85
                    match_detail = "stucco_street_closest"
            else:
                for street, indices in street_hoas.items():
                    score = fuzzy_match_score(parcel_street, street)
                    if score > best_score and score >= 0.7:
                        best_score = score * 0.8
                        best_hoa_idx = indices[0]
                        match_detail = "stucco_street_fuzzy"

        # Municipality-level matching for stucco (slightly more permissive)
        if best_hoa_idx is None and parcel_muni in hoa_by_muni:
            candidates = hoa_by_muni[parcel_muni]
            for idx in candidates:
                hoa_addr = (hoas[idx].get("address", "") or "").upper()
                parcel_addr = (parcel.get("PROP_LOC", "") or "").upper()
                score = fuzzy_match_score(parcel_addr, hoa_addr)
                if score > best_score and score >= 0.5:
                    best_score = score * 0.6
                    best_hoa_idx = idx
                    match_detail = "stucco_muni_address"

        if best_hoa_idx is not None:
            hoa_id = hoas[best_hoa_idx].get("entityId", str(best_hoa_idx))
            hoa_stucco[hoa_id]["stucco"] += 1
            hoa_stucco[hoa_id]["total"] += 1
            stucco_links.append({
                "parcel_address": parcel["PROP_LOC"],
                "parcel_muni": parcel["MUN_NAME"],
                "parcel_zip": parcel["ZIP5"],
                "bldg_desc": parcel.get("BLDG_DESC", ""),
                "hoa_id": hoa_id,
                "hoa_name": hoas[best_hoa_idx]["name"],
                "match_method": match_detail,
                "match_score": round(best_score, 3),
                "is_stucco": True,
            })
            matched += 1

    print(f"  Stucco parcels matched to HOAs: {matched}/{len(stucco_parcels)}")
    print(f"  HOAs with stucco data: {len(hoa_stucco)}")

    return stucco_links, hoa_stucco


# ─── Update HOAs ─────────────────────────────────────────────────────────────
def update_hoas(hoas, hoa_stucco):
    """Update HOA records with stucco confirmation data."""
    print("\n=== Updating HOA Records ===")

    reclassified = {"stucco": 0, "mixed": 0, "non-stucco": 0, "unchanged": 0}
    confirmed_count = 0

    for i, h in enumerate(hoas):
        hoa_id = h.get("entityId", str(i))

        if hoa_id in hoa_stucco:
            data = hoa_stucco[hoa_id]
            total = data["total"]
            stucco = data["stucco"]
            pct = (stucco / total * 100) if total > 0 else 0

            h["stuccoConfirmed"] = stucco
            h["totalParcels"] = total
            h["stuccoPercentage"] = round(pct, 1)
            h["matchMethod"] = "parcel_confirmed"
            confirmed_count += 1

            old_type = h.get("exteriorType", "non-stucco")
            if pct > 50:
                h["exteriorType"] = "stucco"
            elif pct >= 10:
                h["exteriorType"] = "mixed"
            else:
                h["exteriorType"] = "non-stucco"

            if h["exteriorType"] != old_type:
                reclassified[h["exteriorType"]] += 1
            else:
                reclassified["unchanged"] += 1
        else:
            # No parcel data - keep existing classification but mark method
            h["stuccoConfirmed"] = 0
            h["totalParcels"] = 0
            h["stuccoPercentage"] = 0
            if "matchMethod" not in h:
                h["matchMethod"] = "zip_density"

    print(f"  HOAs with confirmed parcel data: {confirmed_count}")
    print(f"  Reclassified to stucco: {reclassified['stucco']}")
    print(f"  Reclassified to mixed: {reclassified['mixed']}")
    print(f"  Reclassified to non-stucco: {reclassified['non-stucco']}")
    print(f"  Classification unchanged: {reclassified['unchanged']}")

    # Final stats
    types = defaultdict(int)
    for h in hoas:
        types[h.get("exteriorType", "unknown")] += 1
    print(f"\n  Final distribution:")
    for t, c in sorted(types.items()):
        print(f"    {t}: {c}")

    return hoas


# ─── Main ────────────────────────────────────────────────────────────────────
def main():
    print("Loading data...")
    hoas = load_json(HOA_PATH)
    condos = load_json(CONDOS_PATH)
    stucco = load_json(STUCCO_PATH)
    print(f"  HOAs: {len(hoas)}")
    print(f"  Condos: {len(condos)} ({sum(1 for c in condos if c.get('FAC_NAME'))} with FAC_NAME)")
    print(f"  Stucco confirmed: {len(stucco)}")

    # Phase 1
    phase1_links = phase1_fac_name_matching(hoas, condos)

    # Phase 2
    phase2_links = phase2_geographic_matching(hoas, condos, phase1_links)

    all_condo_links = phase1_links + phase2_links
    print(f"\n  Total condo-to-HOA links: {len(all_condo_links)}")

    # Phase 3
    stucco_links, hoa_stucco = phase3_stucco_crossref(hoas, stucco, all_condo_links)

    # Update HOAs
    hoas = update_hoas(hoas, hoa_stucco)

    # Combine all links
    all_links = all_condo_links + stucco_links
    print(f"\n  Total parcel-HOA links: {len(all_links)}")

    # Save outputs
    print("\nSaving outputs...")
    save_json(HOA_PATH, hoas)
    save_json(OUTPUT_LINKS, all_links)

    print("\nDone!")


if __name__ == "__main__":
    main()
