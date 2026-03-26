# NJ Stucco HOA Map — Product Plan

## The Vision
Interactive map of New Jersey showing every HOA community. Color-coded: **orange = stucco exteriors**, **blue = non-stucco**. Click an HOA circle to see board members + contact info. Built for stucco remediation/maintenance companies to find bulk contracts (100+ homes per deal).

## Why This Wins
- Stucco homes in NJ = massive market (EIFS/stucco failures are a known epidemic in NJ townhome communities from the 90s-2000s)
- HOA = bulk buyer (1 contract = entire community, not 1 house)
- Nobody has built this tool. Contractors are still cold-calling or driving neighborhoods
- Data is public. Execution is the moat.

---

## Data Pipeline

### Layer 1: NJ HOA List
**Source:** NJ Secretary of State Business Entity Search + NJ Division of Community Affairs

- Search NJ SoS for all entities matching: "homeowners association", "property owners", "condominium association", "community association", "townhome association"
- NJ has ~9,000+ common interest communities (CAI estimates)
- Each filing includes: entity name, registered agent, principal address, officers, status, filing date

**How to get it:**
- NJ Business Gateway Search (njportal.com/DOR/BusinessNameSearch)
- Keyword search + bulk extraction
- Supplement with IRS 501(c)(4)/501(c)(7) data (free bulk download, filter by NJ)

### Layer 2: Property/Parcel Data (for stucco classification)
**Source:** NJ county tax assessor records (21 counties)

- NJ property tax records are available through NJ Division of Taxation (MODIV system)
- Each property record includes: **exterior wall type** (construction material field)
- Cross-reference HOA addresses with parcel data to determine if community is stucco

**Key NJ data portals:**
- NJ MODIV data (Municipal Open Data in Vision) — standardized tax assessment data
- NJ Geographic Information Network (NJGIN) — GIS parcel boundaries
- Individual county assessor sites (MOD-IV extracts)
- ATTOM or Smarty API for bulk property characteristics (paid, but cleaner)

**Stucco classification logic:**
1. Get all parcels within an HOA's geographic boundary
2. Check exterior wall type field for each parcel
3. If >50% of parcels = stucco → mark HOA as "stucco community"
4. Could also use Google Street View + AI vision as verification

### Layer 3: Board Member / Contact Info
**Source:** SoS officer filings + county records + management company directories

- NJ SoS filings list officers (president, secretary, treasurer) for each entity
- Management company info from HOA-USA.com directory
- LinkedIn enrichment for board member names
- County records sometimes have board meeting minutes (public record)

### Layer 4: Geographic Boundaries
**Source:** NJ GIS parcel data + HOA CC&R property descriptions

- NJ has excellent GIS data through NJGIN
- Parcel boundaries available as shapefiles/GeoJSON
- Group parcels by HOA association → create HOA boundary polygons
- Alternative: use subdivision plat maps from county records

---

## Tech Stack

### Frontend (The Map)
- **Next.js** (React) — main app
- **Mapbox GL JS** or **Google Maps JavaScript API** — interactive map
  - Mapbox: better custom styling, $0 up to 50K loads/month
  - Google Maps: satellite/aerial view built-in, more familiar
  - **Recommendation: Mapbox** (better for custom overlays, circles, clustering)
- **Deck.gl** (optional) — for rendering thousands of HOA polygons performantly
- **TailwindCSS** — styling

### Backend
- **Next.js API routes** or **Express** — API layer
- **PostgreSQL + PostGIS** — spatial database (CRITICAL for geo queries)
- **Prisma** — ORM

### Data Pipeline
- **Node.js scripts** — scraping NJ SoS, county assessor data
- **Python** (optional) — for GIS data processing (geopandas, shapely)
- **Bull/Redis** — job queue for data enrichment tasks

### Hosting
- **Vercel** (frontend) + **Render** (API/DB) or all on Render
- **Mapbox** tiles (free tier: 50K loads/month)

---

## Map UX

### Default View
- Zoomed to show all of NJ
- HOA communities shown as circles/polygons on the map
- **Orange circles** = stucco communities
- **Blue circles** = non-stucco communities
- Circle size = number of units in HOA
- Clustering at zoom-out levels (show count badges)

### Interaction
1. **Pan/zoom** — standard map controls, smooth scrolling
2. **Toggle view** — map / satellite / aerial (Mapbox has all three)
3. **Click HOA circle** → popup/sidebar opens:
   - HOA name
   - Address/neighborhood
   - # of units
   - Year built
   - Exterior type (stucco, brick, vinyl, etc.)
   - Management company (if known)
   - Board members list (name + title)
4. **Click board member** → expanded card:
   - Name
   - Position (President, VP, Secretary, Treasurer, Member-at-Large)
   - Phone (if available)
   - Email (if available)
   - LinkedIn profile (if found)
5. **Filters sidebar:**
   - Stucco only / Non-stucco / All
   - Year built range (older = more likely to need remediation)
   - # of units range
   - County filter
   - Management company filter
6. **Search bar** — search by HOA name, address, zip code, city

### Data Export
- Export filtered results as CSV
- Download contact list for selected HOAs

---

## Build Phases

### Phase 1: MVP Map (1 week)
- [ ] Scrape NJ SoS for all HOA entities (~9,000)
- [ ] Geocode each HOA address (Mapbox geocoding API or Google)
- [ ] Build Next.js app with Mapbox map
- [ ] Plot all HOAs as circles on the map
- [ ] Basic click-to-see-details popup
- [ ] Simple sidebar with HOA name, address, officers from SoS
- **Result:** Working map with all NJ HOAs, clickable, with basic info

### Phase 2: Stucco Classification (1 week)
- [ ] Pull NJ MODIV property data (exterior wall type field)
- [ ] Match parcels to HOA communities
- [ ] Classify each HOA as stucco/non-stucco
- [ ] Color-code the map (orange/blue)
- [ ] Add year-built data
- [ ] Add unit count per HOA
- **Result:** Map now shows stucco vs non-stucco with color coding

### Phase 3: Contact Enrichment (1 week)
- [ ] Scrape management company associations
- [ ] Enrich board member names with LinkedIn/email finder
- [ ] Add phone numbers where available (county records, whitepages)
- [ ] Build board member detail cards
- **Result:** Full contact info for board members

### Phase 4: Polish + Export (3-5 days)
- [ ] Satellite/aerial toggle
- [ ] Filters (year, units, county, material type)
- [ ] CSV export
- [ ] Search functionality
- [ ] Mobile responsive
- [ ] Performance optimization (clustering, lazy loading)
- **Result:** Production-ready sales tool

---

## Cost Estimate

| Item | Cost |
|------|------|
| Mapbox (free tier) | $0/month (up to 50K loads) |
| Geocoding (~9K addresses) | ~$4.50 (Mapbox: $0.50/1K) |
| Hosting (Vercel + Render) | $0-25/month |
| NJ SoS data | Free (public) |
| NJ property data (MODIV) | Free (public) |
| IRS data | Free (bulk download) |
| Email enrichment (optional) | $50-200 one-time |
| **Total launch cost** | **~$50-225** |

---

## Who Would Pay For This

1. **Stucco remediation companies** — Hunt's primary target
2. **Roofing companies** — same logic, filter by roof type
3. **Painting contractors** — exterior painting is tied to material
4. **Insurance companies** — stucco homes = higher moisture/mold risk
5. **Property management companies** — prospecting for new HOA clients
6. **Real estate investors** — due diligence on HOA communities

This could be a one-off tool for the stucco company OR a SaaS product sold to multiple contractor types. The data pipeline is the same, just different filters.

---

## NJ-Specific Context

NJ is actually the PERFECT state for this because:
- Dense suburban development with tons of townhome/condo HOAs
- 1990s-2000s EIFS (synthetic stucco) epidemic — thousands of NJ townhome communities have known stucco failure issues
- High property values = homeowners willing to spend on remediation
- 21 counties, all with online assessor data
- Strong HOA legislation (Planned Real Estate Development Full Disclosure Act)
- CAI estimates ~9,000+ community associations in NJ
