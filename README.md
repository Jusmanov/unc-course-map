# Carolina Course Intelligence

A live UNC Chapel Hill course map built with Next.js, Leaflet, and real data from:
- **UNC Registrar** (`reports.unc.edu/class-search`) — live enrollment, section sizes, instructors
- **RateMyProfessors GraphQL API** — real professor ratings, difficulty, would-take-again %

## What it shows

- Interactive map of UNC campus buildings
- Click any building → see every course offered there this semester
- Live enrollment numbers (X/Y seats filled)
- Fill rate color coding (green → red)
- RateMyProfessors ratings pulled live for each instructor

## Local Development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Deploy to Vercel

### Option 1: Vercel CLI
```bash
npm install -g vercel
vercel
```

### Option 2: GitHub + Vercel dashboard
1. Push this repo to GitHub
2. Go to [vercel.com](https://vercel.com) → New Project
3. Import your GitHub repo
4. Vercel auto-detects Next.js — click Deploy

No environment variables required. All API calls are server-side.

## Tech Stack

- **Next.js 14** (App Router)
- **Leaflet** for the map
- **Cheerio** for HTML parsing of UNC class search
- **TypeScript** throughout
- Deployed on **Vercel**

## Data Sources

- UNC Class Search: `https://reports.unc.edu/class-search/`  
- RateMyProfessors GraphQL: `https://www.ratemyprofessors.com/graphql`  
  - UNC School ID: `1232` (base64: `U2Nob29sLTEyMzI=`)

## Notes

- RMP data is cached for 24 hours per professor
- Course data is cached for 1 hour
- The UNC class search scraper parses the HTML table from `reports.unc.edu`
- If UNC changes their HTML structure, update the selectors in `app/api/courses/route.ts`

## Adding More Buildings

Edit `lib/buildings.ts` — add a new entry with the building's coordinates (from Google Maps or UNC's campus map at facilities.unc.edu) and the subject codes taught there.

## Future ideas
- Add historical grade distribution data (file a NC public records request)
- Add "registration speed" — how fast sections fill during registration
- Rate My Professor difficulty scores as a separate map layer
- Mobile-optimized layout
