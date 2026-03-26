# CLAUDE.md

## Project: NJ Stucco HOA Map
An enterprise-grade interactive map application showing every HOA community in New Jersey, color-coded by exterior material (stucco vs non-stucco), with board member contact information. Built for stucco remediation companies to find bulk HOA contracts.

## Tech Stack
- **Framework:** Next.js 15 (App Router)
- **Map:** Mapbox GL JS (free tier, 50K loads/month)
- **Styling:** Tailwind CSS + shadcn/ui components
- **Database:** SQLite (via better-sqlite3) for the MVP — no external DB needed
- **Language:** TypeScript throughout
- **Deployment:** Vercel-ready

## Design Requirements — CRITICAL
This must look **enterprise-grade, client-pitch ready**. Think: a premium SaaS product demo.

### Visual Standards
- Dark sidebar + light map (or full dark mode with Mapbox dark style)
- Glass morphism effects on panels and cards
- Smooth animations on hover/click (framer-motion)
- Premium typography (Inter or Geist font)
- Consistent spacing, no cramped layouts
- Loading skeletons, not spinners
- Subtle shadows and borders, not hard lines
- Color palette: Orange (#F97316) for stucco, Blue (#3B82F6) for non-stucco, dark backgrounds (#0F172A, #1E293B)

### Map UX
- Full viewport map with floating UI panels
- Smooth fly-to animations when clicking HOAs
- Custom map markers (not default pins) — circles with pulse animation
- Cluster markers at zoom-out with count badges
- Popup cards that slide in from the side (not tiny map popups)
- Satellite/aerial toggle button
- Zoom controls styled to match the app

### Sidebar/Panel Design
- Left sidebar: filters + search (collapsible on mobile)
- Right panel: HOA detail view (slides in on click)
- Board member cards with avatars (initials-based), role badges
- Contact info with click-to-copy
- Stats dashboard at top: total HOAs, stucco count, non-stucco count

## Data Strategy
Since we can't scrape live data during build, use **realistic mock data** that demonstrates the full product:

### Mock Data Requirements
- Generate 200+ mock HOA communities spread across NJ's 21 counties
- Each HOA needs: name, address, lat/lng (real NJ coordinates), county, unit count, year built, exterior type (stucco/non-stucco/mixed), management company
- Each HOA needs 3-5 board members with: name, title (President, VP, Secretary, Treasurer, Member-at-Large), phone, email
- Distribute ~40% stucco, ~60% non-stucco (realistic for NJ)
- Cluster HOAs in known NJ suburban areas (Bergen County, Morris County, Middlesex, etc.)
- Use realistic NJ town names and street addresses

### Data Shape
```typescript
interface HOA {
  id: string
  name: string // e.g. "Willowbrook Village HOA"
  address: string
  city: string
  county: string
  state: "NJ"
  zip: string
  lat: number
  lng: number
  unitCount: number
  yearBuilt: number
  exteriorType: "stucco" | "non-stucco" | "mixed"
  managementCompany: string | null
  boardMembers: BoardMember[]
  monthlyFee: number | null
}

interface BoardMember {
  id: string
  name: string
  title: "President" | "Vice President" | "Secretary" | "Treasurer" | "Member-at-Large"
  email: string | null
  phone: string | null
}
```

## Features to Build

### Core (Must Have)
1. Full-screen Mapbox map centered on NJ
2. HOA markers as circles — orange for stucco, blue for non-stucco
3. Click marker → slide-in detail panel with HOA info + board members
4. Search bar (search by HOA name, city, zip)
5. Filter sidebar: exterior type, county, year built range, unit count range
6. Stats bar: total HOAs, stucco count, non-stucco, average unit size
7. Map style toggle (streets / satellite)

### Polish (Make It Amazing)
8. Marker clustering with animated transitions
9. Fly-to animation on marker click
10. Board member cards with click-to-copy contact info
11. CSV export of filtered results
12. Responsive design (mobile: bottom sheet instead of sidebar)
13. Loading states with skeletons
14. Empty states with illustrations
15. Keyboard shortcuts (Esc to close panel, / to focus search)
16. URL state sync (share filtered views via URL params)

## Agent Team Strategy
Use `claude --agent` or subagent delegation to parallelize:
- **Agent 1:** Project scaffolding + map integration + core layout
- **Agent 2:** Mock data generation + data layer + search/filter logic
- **Agent 3:** UI components (sidebar, detail panel, board member cards, stats)
- **Agent 4:** Polish (animations, responsive, export, keyboard shortcuts)

## Environment
- Node.js 24+
- pnpm preferred (or npm)
- Mapbox token: use `NEXT_PUBLIC_MAPBOX_TOKEN` env var (we'll add the real token later, use a placeholder for now)

## No Double Dashes
NEVER use em dashes (—) or double dashes (--) in any UI copy or content strings. Use single dashes or rewrite the sentence.
