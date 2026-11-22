import { useEffect, useId, useRef, useState } from "react";
import type { Exercise, ExerciseKind, PastUnits } from "../../domain/Exercise";
import { unitName, type LoadUnit } from "../../domain/Load";
import { WEEKDAY_SHORT, type Weekday } from "../../domain/LocalDate";
import type { Split } from "../../domain/Split";
import type { WorkoutDay } from "../../domain/WorkoutDay";
import { usePageHold } from "../components/CenterBlock";
import { Icon } from "../components/Icon";
import { BackLink, ScreenHead } from "../components/controls";
import { useLive, useServices } from "../ServicesContext";

/** Field edits saved as they are. The unit goes through SetupService.setUnit, which asks about past sessions. */
type ExerciseChanges = Partial<{ kind: ExerciseKind; targetSets: number | null; targetReps: string | null; targetText: string | null }>;

/**
 * Workout days, their exercises (free-form, as many as you like), and the weekly split.
 * Days start collapsed so the page reads as a short list; tap one to edit it. `openDayId`
 * (from Progress → Edit) opens that day with its removed exercises showing.
 */
export function SetupScreen({ openDayId }: { openDayId?: string | undefined }) {
  const { setup } = useServices();
  const data = useLive(async () => ({ days: await setup.days(), split: await setup.split() }), [], "setup");
  const [newDay, setNewDay] = useState("");
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(() => new Set(openDayId ? [openDayId] : []));
  // Whether you have done anything here yet: opened, closed or added a day, or pressed or typed
  // anywhere in the cards (the day Progress → Edit opened, just shown, doesn't count).
  const [touched, setTouched] = useState(false);
  const touch = () => setTouched(true);
  // The page is centered: while a day is open it holds its place, so the card you're editing stays
  // put as it grows or shrinks (an exercise added or removed). Only once you've touched it: the
  // day the route opened is scrolled into view instead, and a hold starting as the page first
  // draws would keep the offset of the "Loading…" placeholder (a band of empty panel above the
  // title). The press or key comes before the edit it leads to, so the hold is in place before
  // the card changes size. Only days that still exist count, so deleting the open day lets go.
  usePageHold(touched && Boolean(data?.days.some((d) => openIds.has(d.id))));

  // Coming from another screen to edit one day: bring its card into view.
  const ready = Boolean(data);
  useEffect(() => {
    if (ready && openDayId) document.getElementById(`day-card-${openDayId}`)?.scrollIntoView({ block: "start" });
  }, [ready, openDayId]);

  if (!data) return <div className="loading">Loading…</div>;

  const toggle = (id: string) => {
    setTouched(true);
    setOpenIds((ids) => {
      const next = new Set(ids);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const addDay = async () => {
    const name = newDay.trim();
    if (!name) return;
    const day = await setup.createDay(name);
    setNewDay("");
    setTouched(true);
    setOpenIds((ids) => new Set(ids).add(day.id)); // a new day opens so you can add exercises
  };

  return (
    <div className="setup-page">
      <ScreenHead
        title="Workout Days"
        sub="Tap a day to edit it. Removing an exercise keeps its history."
        actions={<BackLink fallback={{ name: "settings" }}>Done</BackLink>}
      />

      <div className="day-cards" onPointerDownCapture={touch} onKeyDownCapture={touch}>
        {data.days.map((day, i) => (
          <DayCard
            key={day.id}
            day={day}
            split={data.split}
            open={openIds.has(day.id)}
            showRemoved={day.id === openDayId}
            onToggle={() => toggle(day.id)}
            first={i === 0}
            last={i === data.days.length - 1}
          />
        ))}
      </div>

      <form
        className="add-row"
        onSubmit={(e) => {
          e.preventDefault();
          void addDay();
        }}
      >
        <input className="field" placeholder="New workout day, e.g. Push" value={newDay} onChange={(e) => setNewDay(e.target.value)} />
        <button className="btn" type="submit" disabled={!newDay.trim()}>
          <Icon name="plus" size={18} /> Add day
        </button>
      </form>

      <div className="section-title">Weekly Split</div>
      <div className="card split-grid">
        {WEEKDAY_SHORT.map((label, i) => (
          <div className="split-row" key={label}>
            <label htmlFor={`split-${i}`}>{label}</label>
            <select
              id={`split-${i}`}
              className="field"
              value={data.split.plannedOn(i as Weekday) ?? ""}
              onChange={(e) => void setup.setPlanned(i as Weekday, e.target.value || null)}
            >
              <option value="">Rest</option>
              {data.days.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
      <p className="small faint" style={{ marginTop: 8 }}>
        Planned days get a red dot on the calendar if nothing is logged. Days like Abs/Cardio can stay off the split and be logged on any rest day.
      </p>
    </div>
  );
}

function DayCard({
  day,
  split,
  open,
  showRemoved,
  onToggle,
  first,
  last,
}: {
  day: WorkoutDay;
  split: Split;
  open: boolean;
  showRemoved: boolean;
  onToggle: () => void;
  first: boolean;
  last: boolean;
}) {
  const { setup } = useServices();
  const [adding, setAdding] = useState("");
  const [removedOpen, setRemovedOpen] = useState(showRemoved);
  const edit = (fn: (d: WorkoutDay) => WorkoutDay) => void setup.updateDay(day.id, fn);
  // Sessions per exercise, for the merge/delete confirmations. Only loaded while the card is open.
  const usage = useLive(() => (open ? setup.usage(day.id) : Promise.resolve(null)), [day.id, open]);

  const addExercises = () => {
    const names = adding.split("\n").map((n) => n.trim()).filter(Boolean);
    if (!names.length) return;
    edit((d) => names.reduce((acc, name) => acc.addExercise(name, /^cardio\b/i.test(name) ? "check" : "strength"), d));
    setAdding("");
  };

  const active = day.activeExercises();
  const removed = day.allExercises().filter((e) => e.archived);
  const weekdays = split.weekdaysFor(day.id).map((w) => WEEKDAY_SHORT[w]);
  const bodyId = `day-${day.id}`;
  /** Sessions with something logged for the exercise; undefined until the counts load. */
  const sessionsOf = (ex: Exercise) => (usage ? (usage.get(ex.id) ?? 0) : undefined);
  const sessionsText = (n: number | undefined) => (n === undefined ? "its sessions" : `${n} session${n === 1 ? "" : "s"}`);

  const merge = (from: Exercise, into: Exercise) => {
    const otherUnit: LoadUnit = into.unit === "plates" ? "lb" : "plates";
    // Both logged in one unit: a later unit switch can't tell their numbers apart (a shared day is
    // one log), so a name that was really in the other unit has to be switched before the merge.
    // Across units the moved sessions keep their unit for good, so the same goes for "from".
    const fromLogged = sessionsOf(from) !== 0;
    const bothLogged = fromLogged && sessionsOf(into) !== 0;
    const units =
      from.kind !== "strength"
        ? ""
        : from.unit !== into.unit
          ? ` "${from.name}" is logged in ${unitName(from.unit)} and "${into.name}" in ${unitName(into.unit)}: each session keeps its unit, and a day with weights under both is combined in pounds.` +
            (fromLogged
              ? ` If the numbers under "${from.name}" are really ${unitName(into.unit)}, cancel and switch it first (⋮ → Log in ${unitName(into.unit)}): after merging, they stay ${unitName(from.unit)}.`
              : "")
          : bothLogged
            ? ` Both are logged in ${unitName(into.unit)}. If only one of them was really logged in ${unitName(otherUnit)}, cancel and switch that one first (⋮ → Log in ${unitName(otherUnit)}): after merging, their numbers can't be told apart.`
            : "";
    const ok = confirm(
      `Merge "${from.name}" into "${into.name}"? Everything logged in ${sessionsText(sessionsOf(from))} moves over and "${from.name}" goes away. This can't be undone.${units}`,
    );
    if (ok) void setup.mergeExercise(day.id, from.id, into.id);
  };

  const remove = (ex: Exercise) => {
    const n = sessionsOf(ex);
    const ok = confirm(
      n === 0
        ? `Delete "${ex.name}"? Nothing has been logged for it.`
        : `Delete "${ex.name}" and everything logged for it in ${sessionsText(n)}? This can't be undone.`,
    );
    if (ok) void setup.deleteExercise(day.id, ex.id);
  };

  const rowProps = (ex: Exercise) => ({
    exercise: ex,
    mergeTargets: day.allExercises().filter((o) => o.id !== ex.id && o.kind === ex.kind),
    onRename: (name: string) => edit((d) => d.withExercise(ex.renamed(name))),
    onChange: (changes: ExerciseChanges) => edit((d) => d.withExercise(ex.with(changes))),
    onMerge: (into: Exercise) => merge(ex, into),
    countInUnit: () => setup.sessionsLoggedIn(day.id, ex.id, ex.unit),
    onSetUnit: (unit: LoadUnit, past: PastUnits) => void setup.setUnit(day.id, ex.id, unit, past),
  });

  return (
    <section id={`day-card-${day.id}`} className={`card day-card${open ? " open" : ""}`} aria-label={day.name}>
      <button type="button" className="day-card-head" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
        <span className="grow">
          <span className="title">{day.name}</span>
          <span className="meta">
            {active.length} exercise{active.length === 1 ? "" : "s"}
            {weekdays.length ? ` · ${weekdays.join(", ")}` : " · any rest day"}
          </span>
        </span>
        <span className="caret">
          <Icon name="down" size={18} />
        </span>
      </button>

      {open && (
        <div className="day-card-body" id={bodyId}>
          <label className="field-label">
            Name
            <input
              className="field"
              defaultValue={day.name}
              key={day.name}
              onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== day.name && edit((d) => d.rename(e.target.value))}
            />
          </label>

          <div>
            <div className="ex-edit-head" aria-hidden>
              <span>Exercise</span>
              <span>Sets × reps</span>
              <span />
            </div>
            <div className="ex-edit-list">
              {active.map((ex, i) => (
                <ExerciseFields
                  key={ex.id}
                  {...rowProps(ex)}
                  first={i === 0}
                  last={i === active.length - 1}
                  onMove={(delta) => edit((d) => d.moveExercise(ex.id, delta))}
                  onRemove={() => edit((d) => d.archiveExercise(ex.id))}
                />
              ))}
              {!active.length && <p className="small faint">No exercises yet.</p>}
            </div>
          </div>

          <div className="add-row">
            <textarea
              className="field"
              rows={1}
              aria-label={`Add exercises to ${day.name}`}
              placeholder="Add exercise"
              value={adding}
              onChange={(e) => setAdding(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !adding.includes("\n")) {
                  e.preventDefault();
                  addExercises();
                }
              }}
            />
            <button type="button" className="btn" onClick={addExercises} disabled={!adding.trim()}>
              <Icon name="plus" size={18} /> Add
            </button>
          </div>

          {removed.length > 0 && (
            <div className="removed">
              <button type="button" className="removed-toggle" aria-expanded={removedOpen} onClick={() => setRemovedOpen((v) => !v)}>
                <span>
                  Removed exercises <span className="faint num">({removed.length})</span>
                </span>
                <span className="caret">
                  <Icon name="down" size={16} />
                </span>
              </button>
              {removedOpen && (
                <>
                  <p className="small faint">History kept for the chart. Rename, merge into another exercise, bring back, or delete.</p>
                  <div className="ex-edit-list">
                    {removed.map((ex) => (
                      <ExerciseFields key={ex.id} {...rowProps(ex)} sessions={sessionsOf(ex)} onRestore={() => edit((d) => d.restoreExercise(ex.id))} onDelete={() => remove(ex)} />
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          <div className="day-card-actions">
            <button type="button" className="chip-btn" disabled={first} onClick={() => void setup.moveDay(day.id, -1)}>
              <Icon name="up" size={15} /> Move up
            </button>
            <button type="button" className="chip-btn" disabled={last} onClick={() => void setup.moveDay(day.id, 1)}>
              <Icon name="dn" size={15} /> Move down
            </button>
            <button
              type="button"
              className="chip-btn danger"
              onClick={() => confirm(`Delete ${day.name}? Its logged sessions stay in your history.`) && void setup.deleteDay(day.id)}
            >
              <Icon name="trash" size={15} /> Delete day
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * One exercise on one line: name, sets × reps (or a target for done/not-done), and a ⋮ for
 * the rest. Active rows can move, change type or unit, merge, or be removed; removed rows can
 * be renamed, merged, restored, or deleted with their history.
 */
function ExerciseFields({
  exercise,
  mergeTargets,
  first,
  last,
  sessions,
  onRename,
  onChange,
  onMerge,
  countInUnit,
  onSetUnit,
  onMove,
  onRemove,
  onRestore,
  onDelete,
}: {
  exercise: Exercise;
  mergeTargets: readonly Exercise[];
  first?: boolean;
  last?: boolean;
  /** Removed rows: sessions with something logged, shown instead of the targets. */
  sessions?: number;
  onRename: (name: string) => void;
  onChange: (changes: ExerciseChanges) => void;
  onMerge: (into: Exercise) => void;
  /** Sessions with weights saved in the exercise's current unit. */
  countInUnit: () => Promise<number>;
  onSetUnit: (unit: LoadUnit, past: PastUnits) => void;
  onMove?: (delta: -1 | 1) => void;
  onRemove?: () => void;
  onRestore?: () => void;
  onDelete?: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  /** While asking what earlier sessions are before a unit switch: how many there are. */
  const [unitAsk, setUnitAsk] = useState<number | null>(null);
  const askId = useId();
  const unitChip = useRef<HTMLButtonElement>(null);
  const asked = useRef(false);
  // Answering the unit question (or Cancel) removes the focused button: focus goes back to the
  // unit chip, where the one-tap switch leaves it. Closing the whole menu leaves it on ⋮.
  useEffect(() => {
    if (unitAsk !== null) asked.current = true;
    else if (asked.current) {
      asked.current = false;
      unitChip.current?.focus();
    }
  }, [unitAsk]);
  const isCheck = exercise.kind === "check";
  const archived = exercise.archived;
  const nextUnit: LoadUnit = exercise.unit === "plates" ? "lb" : "plates";

  const switchUnit = async () => {
    const n = await countInUnit();
    // Nothing saved in the current unit means nothing to keep: switch right away.
    if (n === 0) onSetUnit(nextUnit, "relabel");
    else setUnitAsk(n);
  };
  const answerUnit = (past: PastUnits) => {
    setUnitAsk(null);
    onSetUnit(nextUnit, past);
  };
  return (
    <div className={`ex-edit${menuOpen ? " menu-open" : ""}${archived ? " is-archived" : ""}`}>
      <span className="ex-edit-name">
        <input
          className="field quiet"
          aria-label="Exercise name"
          defaultValue={exercise.name}
          key={exercise.name}
          onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== exercise.name && onRename(e.target.value)}
        />
        {exercise.unit === "plates" && !isCheck && <span className="unit-badge">plates</span>}
      </span>
      {archived ? (
        <span className="ex-edit-count num">{sessions === undefined ? "" : `${sessions} session${sessions === 1 ? "" : "s"}`}</span>
      ) : isCheck ? (
        <input
          className="field target-text"
          aria-label={`${exercise.name} target`}
          placeholder="45 min"
          defaultValue={exercise.targetText ?? ""}
          onBlur={(e) => onChange({ targetText: e.target.value.trim() || null })}
        />
      ) : (
        <span className="sets-reps">
          <input
            className="field num"
            aria-label={`${exercise.name} sets`}
            inputMode="numeric"
            placeholder="3"
            defaultValue={exercise.targetSets ?? ""}
            onBlur={(e) => {
              const n = Number.parseInt(e.target.value, 10);
              onChange({ targetSets: Number.isFinite(n) && n > 0 ? n : null });
            }}
          />
          <span className="x" aria-hidden>
            ×
          </span>
          <input
            className="field num reps"
            aria-label={`${exercise.name} reps`}
            placeholder="8"
            defaultValue={exercise.targetReps ?? ""}
            onBlur={(e) => onChange({ targetReps: e.target.value.trim() || null })}
          />
        </span>
      )}
      <button
        type="button"
        className="icon-btn"
        aria-label={`More for ${exercise.name}`}
        aria-expanded={menuOpen}
        onClick={() => {
          setMenuOpen((v) => !v);
          setUnitAsk(null);
        }}
      >
        <Icon name="dots" size={18} />
      </button>
      {menuOpen && unitAsk !== null && (
        // Switching units with sessions saved in the old one: say what those numbers are.
        <div className="ex-edit-menu">
          <p className="unit-ask" id={askId}>
            Log {exercise.name} in {unitName(nextUnit)} from now on? {unitAsk} earlier session{unitAsk === 1 ? " is" : "s are"} saved in{" "}
            {unitName(exercise.unit)}.
          </p>
          <button type="button" className="chip-btn" aria-describedby={askId} autoFocus onClick={() => answerUnit("keep")}>
            Keep those in {unitName(exercise.unit)}
          </button>
          <button type="button" className="chip-btn" aria-describedby={askId} onClick={() => answerUnit("relabel")}>
            Those were {unitName(nextUnit)}
          </button>
          <button type="button" className="chip-btn" onClick={() => setUnitAsk(null)}>
            Cancel
          </button>
        </div>
      )}
      {menuOpen && unitAsk === null && (
        <div className="ex-edit-menu">
          {onMove && (
            <>
              <button type="button" className="chip-btn" disabled={first} onClick={() => onMove(-1)}>
                <Icon name="up" size={15} /> Up
              </button>
              <button type="button" className="chip-btn" disabled={last} onClick={() => onMove(1)}>
                <Icon name="dn" size={15} /> Down
              </button>
            </>
          )}
          {onRestore && (
            <button type="button" className="chip-btn" onClick={onRestore}>
              <Icon name="refresh" size={15} /> Bring back
            </button>
          )}
          {!archived && (
            <button type="button" className="chip-btn" onClick={() => onChange({ kind: isCheck ? "strength" : "check" })}>
              {isCheck ? "Track weight × reps" : "Make it done / not done"}
            </button>
          )}
          {!isCheck && (
            <button ref={unitChip} type="button" className="chip-btn" onClick={() => void switchUnit()}>
              {exercise.unit === "plates" ? "Log in pounds" : "Log in plates"}
            </button>
          )}
          {mergeTargets.length > 0 && (
            <label className="chip-btn merge-pick">
              Merge into…
              <select
                aria-label={`Merge ${exercise.name} into`}
                value=""
                onChange={(e) => {
                  const into = mergeTargets.find((t) => t.id === e.target.value);
                  if (into) onMerge(into);
                }}
              >
                <option value="" disabled>
                  Merge into…
                </option>
                {mergeTargets.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.archived ? " (removed)" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          {onRemove && (
            <button type="button" className="chip-btn danger" onClick={onRemove}>
              <Icon name="x" size={15} /> Remove
            </button>
          )}
          {onDelete && (
            <button type="button" className="chip-btn danger" onClick={onDelete}>
              <Icon name="trash" size={15} /> Delete with history
            </button>
          )}
        </div>
      )}
    </div>
  );
}
