import { useLayoutEffect, useRef, type ReactNode } from "react";

/**
 * Fills the rest of the screen and centers its content vertically in it (the part below a
 * screen's header). Put it last inside a `.page-fill` column.
 *
 * `hold` freezes the content where it is, e.g. while an exercise row is open: otherwise the
 * growing content would re-center and the row you just tapped would jump up. Released, it
 * re-centers; with the same height as before, nothing moves.
 */
export function CenterBlock({ hold = false, className = "", children }: { hold?: boolean; className?: string; children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const offset = useRef(0);

  useLayoutEffect(() => {
    if (hold || !outer.current || !inner.current) return;
    const o = outer.current;
    const i = inner.current;
    const measure = () => {
      offset.current = Math.max(0, i.getBoundingClientRect().top - o.getBoundingClientRect().top);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(o);
    observer.observe(i);
    return () => observer.disconnect();
  }, [hold]);

  return (
    <div ref={outer} className={`center-block${hold ? " is-held" : ""} ${className}`.trim()} style={hold ? { paddingTop: offset.current } : undefined}>
      <div ref={inner} className="center-block-content">
        {children}
      </div>
    </div>
  );
}
