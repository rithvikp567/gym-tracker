# Gym Tracker — task doc

The single source of truth for this project: infra setup, features, design choices, lessons learned, and the backlog. **Update it in the same change as every feature** (relevant section + changelog), so anyone (or any agent) picking up the repo can start here.

- **Status:** v0.2.0. Supabase connected and signed in; first push to GitHub Pages with this release (see [§3](#3-infra)).
- **Name / URL:** `gym-tracker` → `https://rithvikp567.github.io/gym-tracker/`
- **Last updated:** 2026-11-21

---

## 1. What this is

A personal lift tracker that replaces a Google Sheet. The same exercises are kept for months or years, so the core job is **logging sets, reps, and weight per workout day and seeing how they trend over weeks, months, and years**. Mobile-first (logging at the gym), with a real desktop layout for studying trends.

Workout days: **Upper 1, Lower, Upper 2, Abs/Cardio**. Weekly split:

| Mon | Tue | Wed | Thu | Fri | Sat | Sun |
| --- | --- | --- | --- | --- | --- | --- |
| Upper 1 | Lower | Rest | Upper 2 | Lower | Rest | Rest |

Abs/Cardio happens on at least 2 rest days (any of them), so it stays off the split. Cardio is done / not done; abs exercises are weight × reps like the other days.

### How the old sheet was laid out (from the real export, tab "Upper Lower")

- Month blocks tiled 3 across × 4 down (Feb–Dec 2026; December's block has no month label, Feb's has no WEEK headers).
- Each month has 4 week column groups of **[exercise, weight, reps per set]**, e.g. `160 | 10/10` = 2 sets of 10 at 160. Sets are implied by the reps.
- Inside a week, workout days are stacked: a title row ("Upper 1") after a blank row, then one row per exercise. Target sets sometimes appear in the name: `pulldown (2)`.
- Abs/Cardio holds **two sessions a week** (Cardio 1 + abs, Cardio 2 + abs). There is a single "Lower" per week.
- Two older tabs (`Sheet1`, `Sheet2`) are 2022–2023 push/pull logs in different layouts; not imported (backlog).

---

## 2. Features

Status key: ⬜ not started · 🟨 in progress · ✅ done

### v1 (core)

| # | Feature | Status | Notes |
| --- | --- | --- | --- |
| 1 | **Setup: workout days** | ✅ | Days are collapsible cards, collapsed by default (name, exercise count, planned weekdays). Open one to rename it, edit exercises one per line (name · sets × reps · ⋮ for move / type / remove), add exercises, move or delete the day. Add/rename/reorder/delete days. Add exercises free-form (one per line, as many as you want), each with type (weight × reps, or done / not done), target sets, target reps, or a target like "45 min walk". Removing an exercise archives it so history and chart lines survive. Weekly split editor. |
| 2 | **Home: this week** | ✅ | Week strip (Mon–Sun) with planned day and green/red dot; tap a day to pick it (remembered while you visit other tabs). Below, centered rows for every workout day with "Planned", last done date, and a check if logged on the picked day. First run offers import / setup / sample data. |
| 3 | **Session screen** | ✅ | Phone: exercise name with `2×8 | Last: 20 – 8/6/6` under it, weight and reps on the right. Desktop table: Exercise · Weight · Reps · Last time · Target, evenly spaced. Last session's numbers are a setting. Tap a row to edit sets (weight fills down to later sets; last time's numbers as placeholders; "Same as last time"). Each exercise has a note for that day, hidden behind a note icon until tapped. Change the date to back-fill. Delete a session. |
| 4 | **Swipe through history** | ✅ | Swipe right → the previous time this workout day was done (Lower goes Fri → Tue); swipe left → forward, up to today. Arrow buttons do the same on desktop. Slide animation. |
| 5 | **Calendar** | ✅ | Year view of 12 months, ‹ year › switcher (the year you were on is kept while the app is open), workout count. Green dot = workout, red = missed planned day (D3). Tap a day: one session opens it; otherwise a sheet lists sessions or lets you log one for that date. |
| 6 | **Progress chart** | ✅ | Pick a workout day → one line per exercise (heaviest set per session). Chips toggle lines; the weight axis re-fits to visible lines only. Ranges: Week, Month, 6M, Year, All. A dot on every session. Picked day, range, and hidden lines are remembered on the device. Hover/tap tooltip with crosshair; "Show as a table". |
| 7 | **Import from Google Sheets** | ✅ | `.xlsx` read in the browser, previewed (sessions per day, date range, exercises, notes), weekday chips per day, skip copied weeks, re-runnable. See [§6](#6-google-sheets-import). |
| 8 | **Installable app (PWA)** | ✅ | Manifest + offline service worker, icons, iPhone safe areas. Settings shows "Install" on Android or the Add to Home Screen tip on iPhone; hidden on computers. Not yet installed on a real phone. |
| 9 | **Desktop layout** | ✅ | Left rail nav; Home and Workout Days in a centered 720 px column; session as an A-style table; 3–4 calendar months per row; taller chart. Same colors as mobile. |
| 10 | **Sign-in + sync** | ✅ | Email + password sign-in (D15), offline outbox, two-way sync, newest edit wins. Supabase project `gym-tracker` set up and the owner's account created (sign-ups off). Guide: [docs/SUPABASE_SETUP.md](docs/SUPABASE_SETUP.md). |
| 11 | **Settings** | ✅ | Color style (OLED / Graphite), "Show last session's numbers", workout days and split, import, JSON backup download, account and sync, install. More options TBD. |

---

## 3. Infra

### 3.1 Hosting — GitHub Pages (free)

- GitHub allows **one user site** per account (`rithvikp567.github.io`) but **unlimited project sites**, one per repo. Catan Pangea is a project site, so this is just another repo. **No payment needed.**
- Free Pages needs a **public** repo. The code is public; the workout data is not (it lives in Supabase behind sign-in). GitHub Pro ($4/mo) only if the repo must be private.
- Pipeline (`.github/workflows/deploy-pages.yml`): push to `main` → `npm ci` → `npm test` → `npm run build` → deploy. `BASE_PATH` is set from the repo name.

Checklist:

- [ ] Create public repo `rithvikp567/gym-tracker` from the **personal** account
- [ ] Repo-local git config uses the GitHub noreply email (same as Catan Pangea)
- [ ] First push to `main`
- [ ] Settings → Pages → Source: **GitHub Actions**
- [ ] Settings → Secrets and variables → Actions → **Variables**: `SUPABASE_URL`, `SUPABASE_KEY` (after §3.2)
- [ ] Open the site on the phone → Add to Home Screen

### 3.2 Backend — Supabase (confirmed)

Why Supabase: relational data, built-in auth, row-level security, storage for photos later, and it fits multi-user and competition rooms (backlog a, h). Full walkthrough: [docs/SUPABASE_SETUP.md](docs/SUPABASE_SETUP.md).

Checklist:

- [ ] Create project `gym-tracker` (free plan allows 2 active projects)
- [ ] Run `supabase/migrations/0001_init.sql` in the SQL Editor
- [ ] Sign In / Providers: **Confirm email** off (password sign-in, no emails; D15)
- [ ] Keys into `.env.local` and GitHub Actions variables
- [ ] Create your account in the app, then turn off new sign-ups

Schema: tables `workout_days`, `sessions`, `splits`, each row = one app record as JSON (`data`) + `user_id`, `updated_at`, `deleted`, `server_updated_at`. A trigger keeps the newest copy when an offline device uploads an older one, and stamps server time for "what changed since". RLS: `auth.uid() = user_id`.

### 3.3 Offline-first sync

Every change is written to IndexedDB first (UI never waits on the network) and queued in an outbox in the same transaction. Sync runs after edits (debounced), on app open, on reconnect, and when the app comes back to the foreground: push the outbox (upsert), then pull rows changed since the last pull by server time (5-second overlap, paged), keeping whichever copy has the newer `updatedAt`. Session ids are deterministic (`<workoutDayId>:<date>`), so logging the same day on two devices edits one record instead of creating duplicates.

### 3.4 Tooling notes

- This machine installs npm packages through a private company mirror, so the lockfile records mirror URLs. **After every `npm install`, run `node scripts/public-lockfile.mjs`** (rewrites to registry.npmjs.org; same tarballs and hashes). Never commit internal hostnames.
- `npm audit` reports 4 moderate issues in `workbox-build`'s `glob`/`minimatch` (build-time only, used by the PWA plugin on our own files; nothing ships to the browser). Revisit when vite-plugin-pwa updates.
- Versions at v0.1.0: Vite 8, React 19, TypeScript 7, Vitest 5, Chart.js 4, vite-plugin-pwa 2, supabase-js 2, read-excel-file 9.

---

## 4. Architecture

### 4.1 Stack

| Concern | Choice | Why |
| --- | --- | --- |
| Language | **TypeScript** (strict) | Long-lived project; types catch data-model mistakes early |
| Build | **Vite** | Fast dev server, static build for Pages |
| UI | **React** | Many screens ahead (habits, rooms, settings) |
| Charts | **Chart.js** (lazy-loaded with Progress) | Hidden lines drop out of the axis range, which is exactly feature 6 |
| PWA | **vite-plugin-pwa** | Service worker + manifest |
| Local DB | **IndexedDB** (via `idb`) | Offline-first store |
| Backend | **@supabase/supabase-js** (only loaded when configured) | Auth + sync |
| Sheet import | **read-excel-file** | Reads `.xlsx` in the browser from the npm registry (SheetJS's current builds aren't on npm) |
| Tests | **Vitest** | Gates deploys |

### 4.2 Layers and rules of the road

```
src/
  domain/      Entities + value objects: LocalDate, SetEntry, Exercise, WorkoutDay, Split,
               ExerciseLog, Session, DayStatus. Pure TS, immutable, no I/O.
  services/    Use cases: SetupService, SessionService, CalendarService, ProgressService,
               ImportService, BackupService, SettingsService. ports.ts = the interfaces they need.
  data/        RecordStore interface + IndexedDbRecordStore / MemoryRecordStore,
               StoreRepositories (implements the ports once, for any store), SupabaseSync, NoSync.
  importers/   Grid, cell parsers, SheetImporter interface, MonthGridImporter, readWorkbook.
  app/         AppServices (composition root: the only place that picks implementations), demo data.
  ui/          React: Shell, router (hash routes), ServicesContext hooks, screens/, components/,
               theme/ (tokens.css, base.css, app.css).
```

- Dependencies point inward: `ui → services → domain`; `data` implements `services/ports.ts`.
- `domain/` and `services/` never import React, the DOM, IndexedDB, or Supabase.
- Patterns in use: repository (ports + StoreRepositories), strategy (SheetImporter, RecordStore, SyncController), observer (Emitter / ChangeFeed → `useLive` re-renders on any data change), composition root (AppServices).
- New feature = new service (+ port if it needs storage) + screens. Screens never touch storage directly.
- `?demo` swaps in a MemoryRecordStore with generated sample data, so screens can be tried without real data.

### 4.3 Data model

| Entity | Fields | Notes |
| --- | --- | --- |
| `WorkoutDay` | id, name, order, `exercises[]`, updatedAt, deleted | e.g. Upper 1. Exercises live inside their day |
| `Exercise` | id, name, kind (`strength` / `check`), targetSets, targetReps, targetText, archived | Archived = removed but history kept. Matched across sheet weeks by `Exercise.keyOf(name)` (case, spaces, punctuation, and "(3)" ignored) |
| `Split` | id (`default`), name, `pattern[7]` (Mon-first workout day id or null) | One split for now; backlog b adds many with start dates |
| `Session` | id = `<dayId>:<date>`, date, workoutDayId, `logs[]`, updatedAt, deleted | One per workout day per date |
| `ExerciseLog` | exerciseId, `sets[]`, done, note | `done` only for check exercises; note is per exercise per day |
| `SetEntry` | weight (null = bodyweight), reps | Per set, so "72.5/65 × 5/6" fits |

Progress metric: **heaviest set weight per session**. Later options: estimated 1-rep max, volume.

---

## 5. Design

### 5.1 Direction (chosen 2026-11-21)

**A's look with B's details**: true black, hairline dividers, one accent color on the numbers (A), plus target sets × reps and last session's numbers inline (B). Desktop uses the same colors with A's table layout. Two color styles in Settings:

| Style | Look |
| --- | --- |
| **OLED** (default) | `#000` background, hairline rows, lime accent `#c6f432` |
| **Graphite** | Charcoal `#121214`, raised rounded cards, blue accent `#7db7ff` |

Rejected for now: C (sheet grid, past weeks as columns) and D (one exercise per screen).

### 5.2 Design choices (decision log)

| ID | Date | Decision | Why |
| --- | --- | --- | --- |
| D1 | 2026-11-21 | All colors, radii, and spacing are CSS variables; a theme is a token set (`data-theme` on `<html>`) | Backlog g (user colors) becomes a token override |
| D2 | 2026-11-21 | Chart: time on x, weight on y; hidden lines leave the y-range | "Zoom in when only triceps is on" |
| D3 | 2026-11-21 | Calendar dots: green = workout logged; red = planned day in the past with nothing logged (only after the first logged workout); nothing on rest days or future days | Confirmed by user; red on every rest day would be noise |
| D4 | 2026-11-21 | Tabular figures for numbers | Columns of weights line up |
| D5 | 2026-11-21 | Weights in lb | US gym; unit setting later |
| D6 | 2026-11-21 | Swipe goes to the previous *logged* session of the same workout day, not exactly 7 days back | Lower happens twice a week; skipped weeks shouldn't show blank pages |
| D7 | 2026-11-21 | Session rows show weight + reps like the sheet (`135 · 8/8/7`); target sets × reps come from setup | The sheet's real columns were exercise / weight / reps-per-set |
| D8 | 2026-11-21 | Typing a weight in set 1 fills later sets that were empty or matched it | Most sets use one weight; saves taps mid-workout |
| D9 | 2026-11-21 | Last time's numbers are placeholders, never pre-filled values | Nothing gets logged that you didn't enter; "Same as last time" copies on purpose |
| D10 | 2026-11-21 | Chart colors: 8 fixed, colorblind-checked series colors (`--series-1…8`) assigned by the exercise's slot on its day; archived lines dashed gray and off by default | Color follows the exercise, not which lines are visible |
| D11 | 2026-11-21 | Green/red status colors are fixed across themes (`--good`, `--bad`) and always paired with a legend | Status should mean the same in every theme |
| D12 | 2026-11-21 | Hash routes (`#/session/…`) | Work on GitHub Pages and inside the installed app without server rewrites |
| D13 | 2026-11-21 | ~~Sign-in by emailed 6-digit code, not magic link~~ (replaced by D15) | iPhone home-screen apps have separate storage; links open the browser |
| D14 | 2026-11-21 | Bottom tab bar on phones (Home, Calendar, Progress, Settings), left rail at ≥ 900 px | App-like on mobile, roomy on desktop |
| D16 | 2026-11-21 | Screens remember view choices (`useViewState`): chart day/range/hidden lines on the device; calendar year and Home's picked day until the app closes | Screens unmount on tab switch, which reset filters every time. Filters are preferences; a picked day or year is only useful for this visit |
| D17 | 2026-11-21 | Workout Days page: collapsed cards; one line per exercise; rare actions (reorder, type, remove) behind ⋮ | The all-open form with labels on every field was hard to scan |
| D18 | 2026-11-21 | Chart shows a dot on every session; dense lines get 2.5 px dots without the ring | Days with more sessions (Lower twice a week) showed no dots while Upper 2 did, which read as inconsistent |
| D19 | 2026-11-21 | Desktop session table: Exercise · Weight · Reps · Last time · Target, data columns centered in equal-share tracks | What you log comes first; equal tracks give equal gaps (Last time sat right against Reps) |
| D15 | 2026-11-21 | Sign-in by email + password with Supabase's "Confirm email" off; no emails at all | Supabase blocks template edits (so no codes) until custom SMTP is set up, and its built-in sender only mails org members. Passwords work in the installed iPhone app and Keychain saves them. Revisit with SMTP for multi-user (backlog a) |

### 5.3 Design lessons learned

Carried over from Catan Pangea:

- iPhone browsers can't use the Fullscreen API; the app-like view comes from the installed PWA (`display: standalone`), so show an "Add to Home Screen" tip on iPhone.
- Don't show install prompts on computers (mouse/trackpad as main pointer).
- Verify layouts at real iPhone sizes (~393 × 852), not only desktop.

From this project:

- **Name state classes `is-…`.** A row's `.empty` modifier picked up the global `.empty` empty-state padding and tripled the row height.
- **Dense lines need no dots.** With weekly points over 6 months on a phone, 8 px dots with a background ring made lines look dashed; dots now show only when there's room (hover still shows them).
- **Smooth lines can lie.** Curved interpolation overshot flat steps (weight looked like it dipped); use monotone interpolation.
- **Supabase free projects can't edit auth emails without custom SMTP** (checked 2026-11-21): the template page says "Set up custom SMTP to edit templates", and the built-in sender only delivers to organization members. Don't design a sign-in flow around custom email text until SMTP exists.
- **Inputs don't inherit muted label colors.** A day-name input inside a gray `<label>` rendered gray (inputs inherit `color` here), so `.field` sets its own text color.
- **Equal gaps need equal tracks.** Right-aligned Reps next to a left-aligned Last time column looked cramped no matter the gap; centering every data column in same-width tracks fixed it.
- **Testing tips:** headless Chrome/Brave won't make a window narrower than ~500 px, so screenshot phone layouts inside a 393 px iframe or the browser pane's mobile viewport; `--virtual-time-budget` screenshots don't wait for lazy-loaded chunks.

---

## 6. Google Sheets import

Download the sheet (File → Download → Microsoft Excel), then Settings → Import. Parsed on the device, previewed, then saved. Re-importing updates the same days/dates.

Rules (`MonthGridImporter`):

- **Dates:** the sheet only has "month, week N". Week N = the Nth Monday of the month onward; each session lands on its workout day's weekday from the chips in the preview (default guess: Upper 1 Mon, Lower Tue, Upper 2 Thu). Days with no weekday (Abs/Cardio) go on rest days in order. **Imported dates are approximate.** Year guessed from the sheet; months after December roll over.
- **Reps Google turned into dates** are decoded back: `9/9` → Sep 9 (this year) → 9/9; `8/7/7` → Aug 7 2007 → 8/7/7.
- **Weights:** `72.5/65` per set; one weight applies to all sets; `25 lbs` ok; `Body Weight` = bodyweight; text like `35(down)`, `No straps`, `7ish?` is kept as that day's note.
- **A weight with no reps is treated as planned, not done** (the sheet pre-fills weights). 41 such rows in the real export.
- **Copied weeks:** a week identical to the week before for the same day is skipped by default (24 in the real export).
- **Exercises:** matched by name key; the latest week decides what's active, older names become archived (kept for history). `(n)` in a name sets target sets.
- **Cardio rows** (`Cardio 1`, `Cardio 2`) become one done / not-done "Cardio" exercise; each starts a new Abs/Cardio session.

Real export result (2026-11-21): Upper 1 21 sessions, Lower 22, Upper 2 15, Abs/Cardio 5 (Feb 2 – Oct 20, 2026).

---

## 7. Future features (backlog)

| ID | Feature | Notes |
| --- | --- | --- |
| a | **Multiple users** — create an account, sign in, set up your own workout days and exercises | Auth + RLS already in place. Needs onboarding, re-enabling sign-ups, custom SMTP (then "Confirm email" on, password reset by email, Site URL), and clearing local data when a different user signs in on the same device |
| b | **Configurable splits** — change your split over time; other people have different splits | `Split` is already its own record; add start dates so old weeks keep their old plan for red dots |
| c | **Sleep logging** | Recovery affects lifts; later overlay on the progress chart |
| d | **Creatine tracking** | Daily yes/no |
| e | **Water tracking** | Daily total |
| f | **Meals / calories / macros / body weight** | Biggest of the habit features |
| c–f | → **Habits screen** | One page; each habit a small plug-in (`Habit` interface) with its own service and record type |
| g | **Custom colors** — users set accent/border colors | Token override on top of D1 |
| h | **Competition Room** — see each other's workouts and habits, nudge each other | Needs a, room membership tables + RLS, push notifications |
| i | **Workout photos** attached to that day's workout | **Needs a cost discussion before building.** Compressing to ~200 KB on the phone fits ~5,000 photos in Supabase's free 1 GB; viewing (egress) is what grows with many users |
| j | Import the older push/pull tabs (`Sheet1`, `Sheet2`) | New `SheetImporter` classes; layouts differ (dates per session, plates like "2 plates + 10") |
| k | Restore from a JSON backup | Backup download exists; restore doesn't |
| l | kg / lb setting, estimated 1RM and volume chart metrics | Settings + ProgressService options |
| m | Weekly keep-alive for the free Supabase project | GitHub Actions cron ping, only if pausing becomes annoying |

---

## 8. Open questions

- [ ] Lower on both Tue and Fri? The sheet has one Lower per week; the split above assumes both. Set it in the import preview or Settings → Workout days.
- [ ] Rename "ABS/Cardio" from the sheet to "Abs/Cardio" after import? (Settings → Workout days.)

---

## 9. Changelog

- **2026-11-21** — v0.2.0. Home: centered day rows (centered column on desktop). Session: phone meta reads `2×8 | Last: 20 – 8/6/6`; desktop table reordered to Weight · Reps · Last time · Target with even spacing. Workout Days: "Days" capitalized, collapsible cards (collapsed by default), cleaner one-line exercise editor. Progress: dots on every day's lines. Progress, Calendar, and Home remember their selections across tab switches (D16–D19). First push to GitHub and Pages deploy.
- **2026-11-21** — Sign-in switched from emailed codes to email + password (D15) after Supabase's template page turned out to need custom SMTP. Supabase guide rewritten field by field from the dashboard's current source.
- **2026-11-21** — v0.1.0. All v1 screens built: home week view, session logging with notes and swipe history, year calendar with dots, progress chart with toggles and auto-zoom, workout day/split setup, settings with OLED/Graphite styles, Google Sheets importer (tested on the real export), PWA, IndexedDB storage, Supabase sync code, deploy workflow. 23 unit tests. Not yet pushed or connected to Supabase.
- **2026-11-21** — Project started. Requirements captured, four dark-theme directions mocked, infra plan drafted.
