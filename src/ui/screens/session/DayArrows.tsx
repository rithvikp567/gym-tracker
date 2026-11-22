import { Icon } from "../../components/Icon";

/** ‹ › beside the date on a workout or rest-day screen; pair with `useDayStep`. */
export function DayArrows({ onStep }: { onStep: (delta: -1 | 1) => void }) {
  return (
    <div className="day-arrows" role="group" aria-label="Day">
      <button type="button" className="icon-btn" aria-label="Previous day" onClick={() => onStep(-1)}>
        <Icon name="left" size={20} />
      </button>
      <button type="button" className="icon-btn" aria-label="Next day" onClick={() => onStep(1)}>
        <Icon name="right" size={20} />
      </button>
    </div>
  );
}
