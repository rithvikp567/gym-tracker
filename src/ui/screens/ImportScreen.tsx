import { useMemo, useState } from "react";
import { LocalDate, WEEKDAY_LETTER, type Weekday } from "../../domain/LocalDate";
import type { ImportOptions } from "../../importers/SheetImporter";
import type { WorkbookTab } from "../../importers/readWorkbook";
import type { ImportResult } from "../../services/ImportService";
import { Icon } from "../components/Icon";
import { BackLink, ScreenHead, Toggle } from "../components/controls";
import { href } from "../router";
import { useServices } from "../ServicesContext";

/**
 * Google Sheets → File → Download → Microsoft Excel (.xlsx), then pick it here. Everything is
 * read on this device and previewed before anything is saved.
 */
export function ImportScreen() {
  const { imports } = useServices();
  const [tabs, setTabs] = useState<WorkbookTab[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [tabName, setTabName] = useState("");
  const [options, setOptions] = useState<ImportOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const tab = tabs?.find((t) => t.name === tabName);
  const plan = useMemo(() => (tab?.importer && options ? tab.importer.read(tab.grid, options, fileName) : null), [tab, options, fileName]);

  const pickFile = async (file: File) => {
    setError(null);
    setResult(null);
    setBusy(true);
    try {
      const { readWorkbook } = await import("../../importers/readWorkbook");
      const all = await readWorkbook(file);
      const readable = all.filter((t) => t.importer);
      if (!readable.length) throw new Error("None of the tabs in this file look like the month/week layout this importer understands.");
      // Default to the tab with the most sessions.
      const best = readable
        .map((t) => ({ t, n: t.importer!.read(t.grid, t.importer!.suggestOptions(t.grid), file.name).days.reduce((s, d) => s + d.sessions.length, 0) }))
        .sort((a, b) => b.n - a.n)[0]!.t;
      setTabs(all);
      setFileName(file.name);
      selectTab(best);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const selectTab = (t: WorkbookTab) => {
    setTabName(t.name);
    setOptions(t.importer ? t.importer.suggestOptions(t.grid) : null);
  };

  const toggleWeekday = (day: string, wd: Weekday) => {
    if (!options) return;
    const current = options.weekdays[day] ?? [];
    const next = current.includes(wd) ? current.filter((d) => d !== wd) : [...current, wd].sort();
    setOptions({ ...options, weekdays: { ...options.weekdays, [day]: next } });
  };

  const runImport = async () => {
    if (!plan) return;
    setBusy(true);
    try {
      setResult(await imports.apply(plan));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const totalSessions = plan?.days.reduce((n, d) => n + d.sessions.length, 0) ?? 0;

  return (
    <>
      <ScreenHead
        title="Import"
        sub="From a Google Sheets download (.xlsx)"
        actions={<BackLink fallback={{ name: "settings" }}>Close</BackLink>}
      />

      {result ? (
        <div className="card stack">
          <h2>Imported</h2>
          <p className="muted num">
            {result.sessionsWritten} sessions, {result.daysCreated} new workout days, {result.exercisesCreated} new exercises.
          </p>
          <p className="small faint">Check the weekly split in Settings → Workout Days, so the calendar knows your planned days.</p>
          <a className="btn primary" href={href({ name: "home" })}>
            Go to this week
          </a>
        </div>
      ) : (
        <div className="stack">
          <label className="btn block" style={{ position: "relative" }}>
            <Icon name="upload" size={18} />
            {fileName ? `Change file (${fileName})` : "Choose .xlsx file"}
            <input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }}
              onChange={(e) => e.target.files?.[0] && void pickFile(e.target.files[0])}
            />
          </label>
          {busy && <div className="small muted">Reading…</div>}
          {error && <div className="error-text">{error}</div>}

          {tabs && (
            <label className="stack" style={{ gap: 4 }}>
              <span className="small muted">Tab</span>
              <select className="field" value={tabName} onChange={(e) => selectTab(tabs.find((t) => t.name === e.target.value)!)}>
                {tabs.map((t) => (
                  <option key={t.name} value={t.name} disabled={!t.importer}>
                    {t.name}
                    {t.importer ? "" : " (layout not recognized)"}
                  </option>
                ))}
              </select>
            </label>
          )}

          {options && plan && (
            <>
              <div className="card import-options">
                <div className="setting">
                  <label className="text" htmlFor="import-year">
                    <span className="title">Year the sheet starts in</span>
                    <span className="desc">Guessed from the sheet. Months after December count as the next year.</span>
                  </label>
                  {/* A new file or tab brings a new guess, so the field starts over. */}
                  <YearField
                    key={`${fileName}/${tabName}`}
                    id="import-year"
                    value={options.startYear}
                    onChange={(startYear) => setOptions({ ...options, startYear })}
                  />
                </div>
                <div className="setting">
                  <div className="text" id="import-skip-label">
                    <span className="title">Skip copied weeks</span>
                    <span className="desc">Leaves out weeks that are an exact copy of the week before. The sheet pre-fills those, so they weren't really done.</span>
                  </div>
                  <Toggle label="Skip copied weeks" checked={options.skipCopies} onChange={(skipCopies) => setOptions({ ...options, skipCopies })} />
                </div>
              </div>

              <div className="section-title">Which days do you do each workout?</div>
              <p className="small faint" style={{ marginTop: -4, marginBottom: 8 }}>
                The sheet only has weeks, so each session is placed on its weekday. Leave a day empty (like Abs/Cardio) to place it on rest days.
                This also becomes your weekly split if you haven't set one.
              </p>
              <div className="list">
                {plan.days.map((day) => {
                  const dates = day.sessions.map((s) => s.date);
                  const active = day.exercises.filter((e) => e.active);
                  return (
                    <div className="list-row import-day" key={day.name}>
                      <div className="grow">
                        <div className="title">{day.name}</div>
                        <div className="meta num">
                          {day.sessions.length} sessions
                          {dates.length ? ` · ${LocalDate.parse(dates[0]!).shortLabel()} – ${LocalDate.parse(dates.at(-1)!).shortLabel()}` : ""}
                        </div>
                        <div className="meta">
                          {active.map((e) => e.name).join(", ")}
                          {day.exercises.length > active.length ? ` (+${day.exercises.length - active.length} older)` : ""}
                        </div>
                      </div>
                      <div className="weekday-chips" role="group" aria-label={`${day.name} weekdays`}>
                        {WEEKDAY_LETTER.map((l, i) => (
                          <button
                            key={i}
                            type="button"
                            aria-label={`${day.name} on weekday ${i + 1}`}
                            aria-pressed={(options.weekdays[day.name] ?? []).includes(i as Weekday)}
                            onClick={() => toggleWeekday(day.name, i as Weekday)}
                          >
                            {l}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>

              {(plan.warnings.length > 0 || plan.skippedCopies > 0) && (
                <details>
                  <summary>
                    {plan.skippedCopies > 0 && `${plan.skippedCopies} copied weeks skipped · `}
                    {plan.warnings.length} notes from the import
                  </summary>
                  <ul className="small muted" style={{ paddingLeft: 18 }}>
                    {plan.warnings.slice(0, 200).map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </details>
              )}

              <button type="button" className="btn primary block" disabled={busy || totalSessions === 0} onClick={() => void runImport()}>
                Import {totalSessions} sessions
              </button>
              <p className="small faint">Running it again later updates the same days and dates instead of duplicating them.</p>
            </>
          )}
        </div>
      )}
    </>
  );
}

/**
 * The start year. Typing is free (so "2" → "20" → "2026" works); it only applies once it's a
 * real year, and snaps back to the last good one when you leave the field.
 */
function YearField({ id, value, onChange }: { id: string; value: number; onChange: (year: number) => void }) {
  const [text, setText] = useState(String(value));
  const valid = (t: string) => /^\d{4}$/.test(t) && Number(t) > 1990 && Number(t) < 2100;
  return (
    <input
      id={id}
      className="field num year-field"
      inputMode="numeric"
      maxLength={4}
      value={text}
      onChange={(e) => {
        const t = e.target.value.replace(/\D/g, "");
        setText(t);
        if (valid(t)) onChange(Number(t));
      }}
      onBlur={() => !valid(text) && setText(String(value))}
    />
  );
}
