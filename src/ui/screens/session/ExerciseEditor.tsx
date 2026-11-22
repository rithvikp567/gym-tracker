import { useState } from "react";
import type { Exercise } from "../../../domain/Exercise";
import { ExerciseLog } from "../../../domain/ExerciseLog";
import { HALF_PLATE_LB, PLATE_LB, convertLoad, platesToPounds, unitName, type LoadUnit } from "../../../domain/Load";
import { SetEntry, formatNumber } from "../../../domain/SetEntry";
import type { PastLog } from "../../../services/SessionService";
import { Icon } from "../../components/Icon";
import { useDebounced } from "../../hooks/useSwipe";

interface SetDraft {
  weight: string;
  reps: string;
}

interface Draft {
  sets: SetDraft[];
  done: boolean | null;
  note: string;
}

const text = (n: number | null) => (n === null ? "" : formatNumber(n));

function toDraft(exercise: Exercise, log: ExerciseLog | undefined, last: PastLog | undefined): Draft {
  const saved = log?.filledSets() ?? [];
  const count = saved.length || exercise.targetSets || last?.log.filledSets().length || 1;
  const sets = Array.from({ length: count }, (_, i) => ({ weight: text(saved[i]?.weight ?? null), reps: text(saved[i]?.reps ?? null) }));
  return { sets, done: log?.done ?? null, note: log?.note ?? "" };
}

function parse(value: string): number | null {
  const n = Number.parseFloat(value.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** `unit`: what the weights were typed in, saved with them (none for done / not-done exercises). */
function toLog(exerciseId: string, draft: Draft, unit: LoadUnit | undefined): ExerciseLog {
  const sets = draft.sets.map((s) => new SetEntry(parse(s.weight), parse(s.reps))).filter((s) => !s.isEmpty());
  return ExerciseLog.empty(exerciseId).withSets(sets).withDone(draft.done).withNote(draft.note).withUnit(unit);
}

/** Editing one exercise: sets (weight × reps), done/skipped for cardio, and the day's note. */
export function ExerciseEditor({
  exercise,
  log,
  last,
  onSave,
}: {
  exercise: Exercise;
  log: ExerciseLog | undefined;
  last: PastLog | undefined;
  onSave: (log: ExerciseLog) => void;
}) {
  const [draft, setDraft] = useState(() => toDraft(exercise, log, last));
  const save = useDebounced(onSave, 400);
  // Weights are edited in the unit this day's log was saved in (the exercise's for a new entry),
  // so switching the exercise's unit never changes what an earlier day's numbers mean.
  const unit = log?.unit ?? exercise.unit;
  const plates = unit === "plates";
  const unitPlaceholder = plates ? "plates" : "lb";
  const lastSets = last?.log.filledSets() ?? [];
  const lastUnit = last?.log.unitOr(exercise.unit) ?? unit;
  /** Last time's weight in this editor's unit; null when it can't be said exactly (pounds → plates). */
  const lastWeight = (s: SetEntry | undefined) => {
    const weight = s?.weight ?? null;
    return weight === null ? null : convertLoad(weight, lastUnit, unit);
  };
  const weightsCopy = lastSets.every((s) => s.weight === null || lastWeight(s) !== null);

  const update = (next: Draft) => {
    setDraft(next);
    save(toLog(exercise.id, next, exercise.kind === "check" ? undefined : unit));
  };

  const setWeight = (i: number, value: string) => {
    const old = draft.sets[i]!.weight;
    // Fill down: later sets that were empty or matched the old value follow the new weight.
    const sets = draft.sets.map((s, j) => (j === i || (j > i && (s.weight === "" || s.weight === old)) ? { ...s, weight: value } : s));
    update({ ...draft, sets });
  };

  const setReps = (i: number, value: string) => {
    update({ ...draft, sets: draft.sets.map((s, j) => (j === i ? { ...s, reps: value } : s)) });
  };

  const addSet = () => {
    const prev = draft.sets.at(-1);
    update({ ...draft, sets: [...draft.sets, { weight: prev?.weight ?? "", reps: "" }] });
  };

  const removeSet = (i: number) => update({ ...draft, sets: draft.sets.filter((_, j) => j !== i) });

  // Pounds → plates isn't guessed: the reps are copied and the weights left for you to fill in.
  const copyLast = () => {
    if (!last) return;
    update({ ...draft, sets: lastSets.map((s) => ({ weight: text(lastWeight(s)), reps: text(s.reps) })) });
  };

  const noteField = (
    <textarea
      className="field"
      placeholder="Note for today (hidden until tapped)"
      value={draft.note}
      onChange={(e) => update({ ...draft, note: e.target.value })}
      rows={2}
    />
  );

  if (exercise.kind === "check") {
    return (
      <>
        {exercise.targetText && <div className="small muted">{exercise.targetText}</div>}
        <div className="done-toggle">
          <button type="button" className="btn" aria-pressed={draft.done === true} onClick={() => update({ ...draft, done: draft.done === true ? null : true })}>
            <Icon name="check" size={18} /> Done
          </button>
          <button type="button" className="btn skip" aria-pressed={draft.done === false} onClick={() => update({ ...draft, done: draft.done === false ? null : false })}>
            Skipped
          </button>
        </div>
        {noteField}
      </>
    );
  }

  return (
    <>
      {draft.sets.map((s, i) => (
        <div className="set-row" key={i}>
          <span className="set-label">Set {i + 1}</span>
          <input
            className="set-input"
            inputMode="decimal"
            enterKeyHint="next"
            aria-label={`Set ${i + 1} weight`}
            placeholder={text(lastWeight(lastSets[i])) || unitPlaceholder}
            value={s.weight}
            onChange={(e) => setWeight(i, e.target.value)}
          />
          <span className="times">×</span>
          <input
            className="set-input"
            inputMode="decimal"
            enterKeyHint="next"
            aria-label={`Set ${i + 1} reps`}
            placeholder={lastSets[i]?.reps !== undefined && lastSets[i]?.reps !== null ? text(lastSets[i]!.reps) : "reps"}
            value={s.reps}
            onChange={(e) => setReps(i, e.target.value)}
          />
          <button type="button" className="icon-btn" aria-label={`Remove set ${i + 1}`} onClick={() => removeSet(i)}>
            <Icon name="x" size={16} />
          </button>
        </div>
      ))}
      {plates && <PlatesHint value={parse(draft.sets.find((x) => x.weight.trim())?.weight ?? "")} />}
      {!plates && unit !== exercise.unit && <p className="plates-hint">Saved in {unitName(unit)}, not {unitName(exercise.unit)}</p>}
      <div className="editor-actions">
        <button type="button" className="btn" onClick={addSet}>
          <Icon name="plus" size={16} /> Set
        </button>
        {last && lastSets.length > 0 && (
          <button type="button" className="btn" onClick={copyLast}>
            <Icon name="copy" size={16} /> Same {weightsCopy ? "as" : "reps as"} {last.date.shortLabel()}
          </button>
        )}
      </div>
      {noteField}
    </>
  );
}

/** Under a plates exercise: what the number means, and the pounds it comes to. */
function PlatesHint({ value }: { value: number | null }) {
  return (
    <p className="plates-hint">
      Plates per side · .5 = a {HALF_PLATE_LB} lb plate, 1 = {PLATE_LB} lb
      {value !== null && value > 0 && (
        <>
          {" · "}
          <span className="num">
            {formatNumber(value)} pl = {formatNumber(platesToPounds(value))} lb
          </span>
        </>
      )}
    </p>
  );
}
