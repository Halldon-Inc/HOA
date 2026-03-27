# NJ Stucco HOA Map

Interactive map of New Jersey HOA and condominium communities, color-coded by exterior material type. Built for stucco remediation companies to identify and target communities with stucco/EIFS exterior issues.

## Features

- **Interactive Mapbox GL map** with clustering, fly-to animations, satellite toggle
- **340+ real NJ HOAs** sourced from IRS 501(c) filings, geocoded via Nominatim
- **Color-coded markers**: Orange = Stucco, Blue = Non-stucco, Purple = Mixed
- **Filter sidebar**: search by name/city/zip, filter by exterior type, county, year built, unit count
- **Detail panel** with board member cards, click-to-copy contact info
- **CSV export** for outreach lists
- **URL state sync**, keyboard shortcuts, glass morphism dark theme
- **Data pipeline** (`scripts/build-data.mjs`) for refreshing HOA data from IRS sources

## Tech Stack

- Next.js 15 + React 19
- Mapbox GL JS
- Tailwind CSS + shadcn/ui
- Framer Motion
- TypeScript

## Getting Started

```bash
# Install dependencies
npm install

# Add your Mapbox token
echo "NEXT_PUBLIC_MAPBOX_TOKEN=pk.your_token_here" > .env.local

# Run development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Data Pipeline

The HOA data comes from IRS 501(c) nonprofit filings filtered for NJ housing associations:

```bash
# Regenerate HOA data (requires internet for geocoding)
node scripts/build-data.mjs
```

Pipeline steps:
1. Reads IRS data from `data/nj-hoas-expanded.json`
2. Filters to actual HOA/condo associations (excludes churches, fire companies, etc.)
3. Geocodes addresses via Nominatim (with caching + city-level fallback)
4. Maps zip codes to NJ counties
5. Estimates exterior type based on region and construction era
6. Outputs `public/data/hoas.json`

## Data Sources

- **IRS 501(c) filings**: HOA/condo association registrations
- **Nominatim/OpenStreetMap**: Address geocoding
- **NJ zip code mapping**: County assignment

## License

Private. Halldon Inc.
