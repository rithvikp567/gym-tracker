import { useEffect, useState } from "react";
import type { Exercise, ExerciseKind } from "../../domain/Exercise";
import type { LoadUnit } from "../../domain/Load";
import { WEEKDAY_SHORT, type Weekday } from "../../domain/LocalDate";
import type { Split } from "../../domain/Split";
import type { WorkoutDay } from "../../domain/WorkoutDay";
import { Icon } from "../components/Icon";
import { BackLink, ScreenHead } from "../components/controls";
import { useLive, useServices } from "../ServicesContext";

type ExerciseChanges = Partial<{ kind: ExerciseKind; unit: LoadUnit; targetSets: number | null; targetReps: string | null; targetText: string | null }>;

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

  // Coming from another screen to edit one day: bring its card into view.
  const ready = Boolean(data);
  useEffect(() => {
    if (ready && openDayId) document.getElementById(`day-card-${openDayId}`)?.scrollIntoView({ block: "start" });
  }, [ready, openDayId]);

  if (!data) return <div className="loading">Loading…</div>;

  const toggle = (id: string) =>
    setOpenIds((ids) => {
      const next = new Set(ids);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const addDay = async () => {
    const name = newDay.trim();
    if (!name) return;
    const day = await setup.createDay(name);
    setNewDay("");
    setOpenIds((ids) => new Set(ids).add(day.id)); // a new day opens so you can add exercises
  };

  return (
    <div className="setup-page">
      <ScreenHead
        title="Workout Days"
        sub="Tap a day to edit it. Removing an exercise keeps its history."
        actions={<BackLink fallback={{ name: "settings" }}>Done</BackLink>}
      />

      <div className="day-cards">
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
    const units = from.unit !== into.unit ? ` Note: ${from.name} is logged in ${unitName(from.unit)} and ${into.name} in ${unitName(into.unit)}; numbers aren't converted.` : "";
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

function unitName(unit: LoadUnit): string {
  return unit === "plates" ? "plates" : "pounds";
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
  onMove?: (delta: -1 | 1) => void;
  onRemove?: () => void;
  onRestore?: () => void;
  onDelete?: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const isCheck = exercise.kind === "check";
  const archived = exercise.archived;
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
      <button type="button" className="icon-btn" aria-label={`More for ${exercise.name}`} aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)}>
        <Icon name="dots" size={18} />
      </button>
      {menuOpen && (
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
            <button type="button" className="chip-btn" onClick={() => onChange({ unit: exercise.unit === "plates" ? "lb" : "plates" })}>
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
