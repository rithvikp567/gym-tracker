import { useEffect, useState } from "react";

/**
 * True once `on` has stayed true for `ms`; false again as soon as it turns false. A timer rather
 * than a CSS animation delay: Reduce Motion turns animations off, and what this drives (dimming
 * stale rows) should stay.
 */
export function useLasting(on: boolean, ms: number): boolean {
  const [lasted, setLasted] = useState(false);
  useEffect(() => {
    if (!on) return;
    const timer = setTimeout(() => setLasted(true), ms);
    return () => {
      clearTimeout(timer);
      setLasted(false);
    };
  }, [on, ms]);
  return on && lasted;
}
