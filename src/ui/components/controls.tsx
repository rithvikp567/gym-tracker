import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { goBack, href, type Route } from "../router";
import { Icon } from "./Icon";
import { boxOf, canAnimate, easeOut, growKeyframes, prefersReducedMotion, pressedControl } from "../motion";

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly { key: T; label: string }[];
  value: T;
  onChange: (key: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.key} type="button" aria-pressed={o.key === value} onClick={() => onChange(o.key)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" className="toggle" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} />;
}

/** How long a sheet takes to open, and to close. */
const SHEET_IN_MS = 240;
const SHEET_OUT_MS = 180;

/** Closes the sheet it's in, with the sheet's closing animation (for Done, Create and the like). */
const SheetCloseContext = createContext<() => void>(() => {});
export const useSheetClose = () => useContext(SheetCloseContext);

/**
 * Bottom sheet on phones, centered dialog on desktop. Drawn into <body>, not where it's used: the
 * page block it would sit in moves (the page-switch rise, the glide after a hold), and a moving
 * block becomes the box a `position: fixed` backdrop is placed in. A tap on the backdrop closes
 * it; a press that starts inside (selecting text past the edge) and is let go outside doesn't.
 *
 * Motion (D55): it grows out of `growFrom` (the button that opened it) and shrinks back into it
 * when it closes, or rises in and drops away when there's no button; under Reduce Motion it only
 * fades. `onClose` runs once the closing animation ends; `head` replaces the plain title (null: none).
 */
export function Sheet({
  title,
  onClose,
  children,
  growFrom,
  head,
  className,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  growFrom?: HTMLElement | null;
  head?: ReactNode;
  className?: string;
}) {
  const pressedBackdrop = useRef(false);
  const backdrop = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const closing = useRef(false);
  // The button that opened it: given, or the control just pressed.
  const [from] = useState(() => growFrom ?? pressedControl());

  useLayoutEffect(() => {
    const animations = sheetMotion(backdrop.current, panel.current, from, "in");
    return () => animations.forEach((a) => a.cancel());
    // Once, as it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    const animations = sheetMotion(backdrop.current, panel.current, from, "out");
    if (!animations.length) return onClose();
    void Promise.all(animations.map((a) => a.finished)).then(onClose, onClose);
  }, [from, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  return createPortal(
    <SheetCloseContext.Provider value={close}>
      <div
        ref={backdrop}
        className="sheet-backdrop"
        onPointerDown={(e) => (pressedBackdrop.current = e.target === e.currentTarget)}
        onClick={(e) => {
          if (pressedBackdrop.current && e.target === e.currentTarget) close();
          pressedBackdrop.current = false;
        }}
      >
        <div ref={panel} className={`sheet${className ? ` ${className}` : ""}`} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
          {head === undefined ? <h2 style={{ marginBottom: 12 }}>{title}</h2> : head}
          {children}
        </div>
      </div>
    </SheetCloseContext.Provider>,
    document.body,
  );
}

/**
 * A sheet opening ("in") or closing ("out"): the backdrop fades; the panel grows out of `from`'s
 * box (or shrinks back into it), rises in or drops away without one, and only fades under Reduce
 * Motion. Closing holds the last frame until the sheet is gone. Nothing where Web Animations
 * can't run (the caller then closes at once).
 */
function sheetMotion(backdrop: HTMLElement | null, panel: HTMLElement | null, from: HTMLElement | null, way: "in" | "out"): Animation[] {
  if (!canAnimate(panel) || !backdrop) return [];
  const timing: KeyframeAnimationOptions = { duration: way === "in" ? SHEET_IN_MS : SHEET_OUT_MS, easing: easeOut(panel), fill: way === "out" ? "forwards" : "none" };
  const fade: Keyframe[] = [{ opacity: 0 }, { opacity: 1 }];
  const source = boxOf(from);
  const target = boxOf(panel);
  const moves = !prefersReducedMotion();
  let keyframes: Keyframe[] = fade;
  if (moves && source && target) keyframes = growKeyframes(source, target);
  else if (moves) keyframes = [{ transform: "translateY(24px)", opacity: 0 }, { transform: "none", opacity: 1 }];
  const run = (frames: Keyframe[]) => (way === "in" ? frames : [...frames].reverse());
  return [backdrop.animate(run(fade), timing), panel.animate(run(keyframes), timing)];
}

/**
 * A page's title, centered, with its sub line; `actions` (Done, Close) sit at the right.
 * `className` adds to the header's (Progress puts its title on a tile).
 */
export function ScreenHead({ title, sub, actions, className }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <header className={["screen-head", actions ? "has-actions" : "", className ?? ""].filter(Boolean).join(" ")}>
      <div className="head-text">
        <h1>{title}</h1>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {actions && <div className="head-actions">{actions}</div>}
    </header>
  );
}

/**
 * The ‹ at the top left: returns to the screen you came from (Calendar, Home, Progress…),
 * or to `fallback` when this screen was opened directly.
 */
export function BackButton({ fallback, label = "Back" }: { fallback: Route; label?: string }) {
  return (
    <a
      className="icon-btn"
      href={href(fallback)}
      aria-label={label}
      onClick={(e) => {
        e.preventDefault();
        goBack(fallback);
      }}
    >
      <Icon name="left" />
    </a>
  );
}

/** A text link that does the same (Done, Close). */
export function BackLink({ fallback, children }: { fallback: Route; children: ReactNode }) {
  return (
    <a
      className="link"
      href={href(fallback)}
      onClick={(e) => {
        e.preventDefault();
        goBack(fallback);
      }}
    >
      {children}
    </a>
  );
}
