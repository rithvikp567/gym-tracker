import type { ReactNode } from "react";
import { Icon } from "../../components/Icon";

/**
 * ‹ date › on a workout or rest-day screen: the arrows step a day either way (pair with
 * `useDayStep`), the date between them opens the date picker.
 */
export function DayArrows({ onStep, children }: { onStep: (delta: -1 | 1) => void; children: ReactNode }) {
  return (
    <div className="day-stepper" role="group" aria-label="Day">
      <button type="button" className="icon-btn" aria-label="Previous day" onClick={() => onStep(-1)}>
        <Icon name="left" size={20} />
      </button>
      {children}
      <button type="button" className="icon-btn" aria-label="Next day" onClick={() => onStep(1)}>
        <Icon name="right" size={20} />
      </button>
    </div>
  );
}
