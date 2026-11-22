# Notes for coding agents

- Read `TASKS.md` first. Update it in the same change as every feature: the features table, the decision log, lessons learned, and the changelog.
- Layers (see TASKS.md §4): `domain/` and `services/` are plain TypeScript with no React, DOM, IndexedDB, or Supabase imports. Services depend on interfaces in `services/ports.ts`; implementations live in `data/`. Screens talk only to services (via `useServices()`), never to storage.
- Domain objects are immutable: methods return new instances.
- New spreadsheet layouts = a new `SheetImporter` class registered in `importers/readWorkbook.ts`.
- Colors come from tokens in `src/ui/theme/tokens.css`; never hard-code colors in components. Chart series use `--series-1…8` in fixed order, assigned by the exercise's slot on its day.
- Before finishing: `npm test`, `npm run typecheck`, `npm run build`. For UI checks use `http://localhost:5173/?demo` (in-memory sample data).
- After `npm install`, run `node scripts/public-lockfile.mjs` (this machine installs through a private mirror; the lockfile must point at registry.npmjs.org).
- Pushes go from the personal GitHub account `rithvikp567` with its GitHub noreply email set repo-locally, never a work account or work email. Branch per feature, PR into `main`.
- The user's real workout export is never committed (`*.xlsx` is ignored).
