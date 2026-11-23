import { useEffect } from "react";
import { useServices } from "../ServicesContext";
import { ringAlarm } from "./alarm";

/** Rings when the rest timer reaches zero, on whatever screen is open. Renders nothing. */
export function TimerAlarm() {
  const { timer } = useServices();
  useEffect(() => timer.onRing(ringAlarm), [timer]);
  return null;
}
