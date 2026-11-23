import { useEffect, useState } from "react";
import type { TimerState } from "../../services/TimerService";
import { useServices } from "../ServicesContext";

/** The timers and the time to show them at; ticks four times a second while one is counting. */
export function useTimer(): { state: TimerState; now: number } {
  const { timer } = useServices();
  const [state, setState] = useState(() => timer.get());
  const [now, setNow] = useState(() => timer.now());

  useEffect(() => {
    setState(timer.get());
    setNow(timer.now());
    return timer.subscribe((next) => {
      setState(next);
      setNow(timer.now());
    });
  }, [timer]);

  const counting = state.rest.status(now) === "running" || state.stopwatch.status(now) === "running";
  useEffect(() => {
    if (!counting) return;
    const tick = () => setNow(timer.now());
    const id = setInterval(tick, 250);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [counting, timer]);

  return { state, now };
}
