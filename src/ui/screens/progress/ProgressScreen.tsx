import { useEffect, useMemo, useState } from "react";
import { RANGES, type ProgressLine, type RangeKey } from "../../../services/ProgressService";
import { useHoldBriefly, usePageHold } from "../../components/CenterBlock";
import { ScreenHead, Segmented } from "../../components/controls";
import { useLookVersion } from "../../hooks/useLookVersion";
import { useViewState } from "../../hooks/useViewState";
import { href, navigate } from "../../router";
import { useLiveState, useServices, useSettings } from "../../ServicesContext";
import { WeightChart } from "./WeightChart";

const SERIES = 8;

/**
 * Pick a workout day → one line per exercise. Tap the chips to show/hide lines; the weight
 * axis re-fits to whatever is visible. The picked day, range, and hidden lines are remembered
 * on this device, so leaving the tab (or the app) doesn't reset them.
 */
export function ProgressScreen({ dayId: routeDayId }: { dayId: string | null }) {
  const { setup, progress } = useServices();
  const { theme } = useSettings();
  const holdBriefly = useHoldBriefly();
  const [range, setRange] = useViewState<RangeKey>("progress.range", () => "6M", "device");
  const [lastDayId, setLastDayId] = useViewState<string | null>("progress.day", () => null, "device");
  const daysLive = useLiveState(() => setup.days(), [], "days");
  const days = daysLive.value;
  // The Progress tab links to #/progress with no day: use the one picked last time.
  const day = days?.find((d) => d.id === (routeDayId ?? lastDayId)) ?? days?.[0];
  useEffect(() => {
    if (day && day.id !== lastDayId) setLastDayId(day.id);
  }, [day, lastDayId, setLastDayId]);
  const live = useLiveState(() => (day ? progress.lines(day.id, range) : Promise.resolve(null)), [day?.id ?? null, range], "progress");
  const data = live.value;

  // Color follows the exercise (its slot on the day), never its position among visible lines.
  // Read again whenever the look changes: the series colors differ between light and dark themes.
  const look = useLookVersion();
  const colors = useMemo(() => {
    const map = new Map<string, string>();
    const root = getComputedStyle(document.documentElement);
    day?.activeExercises().forEach((ex, i) => {
      map.set(ex.id, root.getPropertyValue(i < SERIES ? `--series-${i + 1}` : "--series-other").trim());
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `look` only says when to read again
  }, [day, look]);

  // Hidden lines are kept per workout day. First visit: active exercises on, archived off.
  const [hiddenIds, setHiddenIds] = useViewState<string[]>(
    `progress.hidden.${day?.id ?? "none"}`,
    () => day?.allExercises().filter((e) => e.archived).map((e) => e.id) ?? [],
    "device",
  );
  const hidden = useMemo(() => new Set(hiddenIds), [hiddenIds]);
  // Showing or hiding lines can add or remove the table tile: the page holds its place for a
  // moment, so the chips stay under your finger.
  const setHidden = (next: Set<string>) => {
    holdBriefly();
    setHiddenIds([...next]);
  };

  // The table opens below everything else: while it's open the page holds its place instead of
  // re-centering (on a tall window the "Show as a table" you just clicked would jump up).
  const [tableOpen, setTableOpen] = useState(false);
  const lines = data?.lines ?? [];
  const visible = lines.filter((l) => !hidden.has(l.exercise.id));
  usePageHold(tableOpen && visible.length > 0);

  // "No days" and "nothing logged" only from fresh data: an older copy would say so by mistake.
  if (!days || (!day && !daysLive.fresh)) return <div className="loading">Loading…</div>;
  if (!day) {
    return (
      <div className="progress">
        <ScreenHead title="Progress" className="tile progress-head" />
        <div className="tile empty">
          <p>Set up your workout days first, then your lifts will chart here.</p>
          <a className="btn" href={href({ name: "setup" })}>
            Set up workout days
          </a>
        </div>
      </div>
    );
  }

  const toggle = (id: string) => {
    const next = new Set(hidden);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setHidden(next);
  };

  return (
    <div className="progress">
      <ScreenHead
        title="Progress"
        className="tile progress-head"
        sub={day.allExercises().some((e) => e.unit === "plates") ? "Plates counted in lb" : undefined}
      />
      {/* Each picker is its own tile. A pick can change the page's height (a range with nothing
          logged), so the page holds its place for a moment and the pickers stay under your finger. */}
      <div className="progress-controls">
        <Segmented
          label="Workout day"
          options={days.map((d) => ({ key: d.id, label: d.name }))}
          value={day.id}
          onChange={(id) => {
            holdBriefly();
            navigate({ name: "progress", dayId: id }, { replace: true });
          }}
        />
        <Segmented
          label="Time range"
          options={RANGES}
          value={range}
          onChange={(key) => {
            holdBriefly();
            setRange(key);
          }}
        />
      </div>

      {data && lines.length === 0 && live.fresh && (
        <div className="tile empty chart-empty">
          <p>No weights logged for {day.name} in this range.</p>
        </div>
      )}

      {data && lines.length > 0 && (
        <>
          <div className="tile chart-tile">
            <WeightChart data={data} range={range} colors={colors} hidden={hidden} theme={theme} />
          </div>
          <section className="tile series-tile" aria-label="Exercises">
            <div className="section-title">
              <span>Exercises</span>
              <span className="inline">
                <button type="button" className="link" onClick={() => setHidden(new Set())}>
                  All
                </button>
                <button type="button" className="link" onClick={() => setHidden(new Set(lines.map((l) => l.exercise.id)))}>
                  None
                </button>
                {/* Rename, merge (e.g. old spellings of one lift), restore, or delete exercises. */}
                <a className="link" href={href({ name: "setup", dayId: day.id })}>
                  Edit
                </a>
              </span>
            </div>
            <div className="series-chips">
              {lines.map((line) => (
                <button
                  key={line.exercise.id}
                  type="button"
                  className="series-chip"
                  aria-pressed={!hidden.has(line.exercise.id)}
                  onClick={() => toggle(line.exercise.id)}
                >
                  <span className="swatch" style={{ background: colors.get(line.exercise.id) ?? "var(--series-other)" }} />
                  {line.exercise.name}
                  {line.exercise.unit === "plates" && <span className="archived">plates</span>}
                  {line.exercise.archived && <span className="archived">old</span>}
                </button>
              ))}
            </div>
          </section>
          {visible.length > 0 && <DataTable lines={visible} open={tableOpen} onToggle={setTableOpen} />}
        </>
      )}
    </div>
  );
}

/**
 * The same numbers as a table (accessibility, and for reading exact values). Open or closed is
 * kept by the screen, so it stays open when hiding every line removes it and showing one brings it back.
 */
function DataTable({ lines, open, onToggle }: { lines: ProgressLine[]; open: boolean; onToggle: (open: boolean) => void }) {
  const dates = [...new Set(lines.flatMap((l) => l.points.map((p) => p.date.toString())))].sort().reverse();
  const value = (line: ProgressLine, date: string) => {
    const p = line.points.find((x) => x.date.toString() === date);
    return p ? p.label : "";
  };
  return (
    <details className="tile table-tile" open={open} onToggle={(e) => onToggle(e.currentTarget.open)}>
      <summary>Show as a table</summary>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              {lines.map((l) => (
                <th key={l.exercise.id}>{l.exercise.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dates.map((d) => (
              <tr key={d}>
                <td>{d}</td>
                {lines.map((l) => (
                  <td key={l.exercise.id}>{value(l, d)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
