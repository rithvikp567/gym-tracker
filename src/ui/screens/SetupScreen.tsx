import { useState } from "react";
import type { Exercise, ExerciseKind } from "../../domain/Exercise";
import { WEEKDAY_SHORT, type Weekday } from "../../domain/LocalDate";
import type { Split } from "../../domain/Split";
import type { WorkoutDay } from "../../domain/WorkoutDay";
import { Icon } from "../components/Icon";
import { ScreenHead } from "../components/controls";
import { href } from "../router";
import { useLive, useServices } from "../ServicesContext";

type ExerciseChanges = Partial<{ name: string; kind: ExerciseKind; targetSets: number | null; targetReps: string | null; targetText: string | null }>;

/**
 * Workout days, their exercises (free-form, as many as you like), and the weekly split.
 * Days start collapsed so the page reads as a short list; tap one to edit it.
 */
export function SetupScreen() {
  const { setup } = useServices();
  const data = useLive(async () => ({ days: await setup.days(), split: await setup.split() }), []);
  const [newDay, setNewDay] = useState("");
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(new Set());

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
        actions={
          <a className="link" href={href({ name: "settings" })}>
            Done
          </a>
        }
      />

      <div className="day-cards">
        {data.days.map((day, i) => (
          <DayCard
            key={day.id}
            day={day}
            split={data.split}
            open={openIds.has(day.id)}
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
  onToggle,
  first,
  last,
}: {
  day: WorkoutDay;
  split: Split;
  open: boolean;
  onToggle: () => void;
  first: boolean;
  last: boolean;
}) {
  const { setup } = useServices();
  const [adding, setAdding] = useState("");
  const edit = (fn: (d: WorkoutDay) => WorkoutDay) => void setup.updateDay(day.id, fn);

  const addExercises = () => {
    const names = adding.split("\n").map((n) => n.trim()).filter(Boolean);
    if (!names.length) return;
    edit((d) => names.reduce((acc, name) => acc.addExercise(name, /^cardio\b/i.test(name) ? "check" : "strength"), d));
    setAdding("");
  };

  const active = day.activeExercises();
  const weekdays = split.weekdaysFor(day.id).map((w) => WEEKDAY_SHORT[w]);
  const bodyId = `day-${day.id}`;

  return (
    <section className={`card day-card${open ? " open" : ""}`} aria-label={day.name}>
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
                  exercise={ex}
                  first={i === 0}
                  last={i === active.length - 1}
                  onChange={(changes) => edit((d) => d.withExercise(ex.with(changes)))}
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

/** One exercise on one line: name, sets × reps (or a target for done/not-done), and a ⋮ for the rest. */
function ExerciseFields({
  exercise,
  first,
  last,
  onChange,
  onMove,
  onRemove,
}: {
  exercise: Exercise;
  first: boolean;
  last: boolean;
  onChange: (changes: ExerciseChanges) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const isCheck = exercise.kind === "check";
  return (
    <div className={`ex-edit${menuOpen ? " menu-open" : ""}`}>
      <input
        className="field quiet"
        aria-label="Exercise name"
        defaultValue={exercise.name}
        key={exercise.name}
        onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== exercise.name && onChange({ name: e.target.value })}
      />
      {isCheck ? (
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
        onClick={() => setMenuOpen((v) => !v)}
      >
        <Icon name="dots" size={18} />
      </button>
      {menuOpen && (
        <div className="ex-edit-menu">
          <button type="button" className="chip-btn" disabled={first} onClick={() => onMove(-1)}>
            <Icon name="up" size={15} /> Up
          </button>
          <button type="button" className="chip-btn" disabled={last} onClick={() => onMove(1)}>
            <Icon name="dn" size={15} /> Down
          </button>
          <button type="button" className="chip-btn" onClick={() => onChange({ kind: isCheck ? "strength" : "check" })}>
            {isCheck ? "Track weight × reps" : "Make it done / not done"}
          </button>
          <button type="button" className="chip-btn danger" onClick={onRemove}>
            <Icon name="x" size={15} /> Remove
          </button>
        </div>
      )}
    </div>
  );
}
