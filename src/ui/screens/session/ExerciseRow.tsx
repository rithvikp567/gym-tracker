import type { KeyboardEvent } from "react";
import type { Exercise } from "../../../domain/Exercise";
import type { ExerciseLog } from "../../../domain/ExerciseLog";
import type { PastLog } from "../../../services/SessionService";
import { Icon } from "../../components/Icon";
import { ExerciseEditor } from "./ExerciseEditor";

interface Props {
  exercise: Exercise;
  log: ExerciseLog | undefined;
  last: PastLog | undefined;
  showLast: boolean;
  open: boolean;
  onToggle: () => void;
  /** The day's note is peeked at from the screen (it holds the list still while one is open). */
  noteOpen: boolean;
  onToggleNote: () => void;
  onSave: (log: ExerciseLog) => void;
}

/**
 * One exercise in a session. Collapsed: name, target (3×8), last time, weight, reps.
 * Tap to open the editor; tap the note icon to peek at that day's note.
 */
export function ExerciseRow({ exercise, log, last, showLast, open, onToggle, noteOpen, onToggleNote, onSave }: Props) {
  const note = log?.note.trim() ?? "";
  const isCheck = exercise.kind === "check";

  // Each log is labeled in the unit it was saved in ("360" stays pounds after a switch to plates);
  // exercise.bareUnit covers logs saved without one.
  const value = isCheck
    ? log?.done === true
      ? "Done"
      : log?.done === false
        ? "Skipped"
        : ""
    : (log?.weightLabel(exercise.bareUnit) ?? "");
  const target = exercise.targetLabel();
  // Phone: "2×8 | Last: 20 – 8/6/6". Desktop shows the same value in its own column, minus "Last:".
  const lastText = last ? last.log.summary(" – ", exercise.bareUnit) : "";

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onToggle();
    }
  };

  return (
    <div className={`ex-row${open ? " open" : ""}`} onClick={onToggle}>
      <div className="ex-name">
        <span className="label" role="button" tabIndex={0} aria-expanded={open} onKeyDown={onKey}>
          {exercise.name}
        </span>
        {note && (
          <button
            type="button"
            className="note-btn"
            aria-label={noteOpen ? "Hide note" : "Show note"}
            aria-expanded={noteOpen}
            onClick={(e) => {
              e.stopPropagation();
              onToggleNote();
            }}
          >
            <Icon name="note" size={15} />
          </button>
        )}
      </div>
      <div className="ex-meta num">
        <span className="ex-target">{target}</span>
        {showLast && lastText && (
          <>
            {target && <span className="sep" />}
            <span className="ex-last">
              <span className="prefix">Last: </span>
              {lastText}
            </span>
          </>
        )}
      </div>
      <div className={`ex-weight${value ? "" : " is-empty"}`}>{value || "—"}</div>
      <div className="ex-reps">{isCheck ? "" : log?.repsLabel()}</div>
      {noteOpen && note && !open && <div className="ex-note-view">{note}</div>}
      {open && (
        <div className="ex-editor" onClick={(e) => e.stopPropagation()}>
          <ExerciseEditor exercise={exercise} log={log} last={last} onSave={onSave} />
        </div>
      )}
    </div>
  );
}
