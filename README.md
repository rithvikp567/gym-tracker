# Gym Tracker

Log sets, reps, and weight for each workout day, swipe back through past weeks, see a year of workouts on a calendar, and chart every lift over time. Mobile-first, installable as an app, works offline, and syncs between devices through Supabase.

**Start with [TASKS.md](TASKS.md)**: features, infra, design decisions, lessons learned, and the backlog.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
npm run dev:phone    # same, reachable from your phone on the same Wi-Fi
```

- `http://localhost:5173/?demo` shows sample data in memory (nothing saved), handy for trying screens.
- Sync is off until you add Supabase keys to `.env.local`; see [docs/SUPABASE_SETUP.md](docs/SUPABASE_SETUP.md).

## Check it

```bash
npm test             # unit tests (also gate every deploy)
npm run typecheck
npm run build
```

Run the importer on your own export without committing it (`*.xlsx` is git-ignored):

```bash
GYM_SHEET="$HOME/Downloads/Gym Tracker.xlsx" npx vitest run tests/realSheet.test.ts --silent=false
```

## Deploy

Pushing to `main` runs `.github/workflows/deploy-pages.yml`: install → test → build → GitHub Pages at `https://rithvikp567.github.io/gym-tracker/`.

After any `npm install`, run `node scripts/public-lockfile.mjs` so the lockfile points at the public npm registry.
