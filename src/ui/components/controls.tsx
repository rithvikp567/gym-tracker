import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { goBack, href, type Route } from "../router";
import { Icon } from "./Icon";

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

/**
 * Bottom sheet on phones, centered dialog on desktop. Drawn into <body>, not where it's used: the
 * page block it would sit in moves (the page-switch rise, the glide after a hold), and a moving
 * block becomes the box a `position: fixed` backdrop is placed in. A tap on the backdrop closes
 * it; a press that starts inside (selecting text past the edge) and is let go outside doesn't.
 */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const pressedBackdrop = useRef(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div
      className="sheet-backdrop"
      onPointerDown={(e) => (pressedBackdrop.current = e.target === e.currentTarget)}
      onClick={(e) => {
        if (pressedBackdrop.current && e.target === e.currentTarget) onClose();
        pressedBackdrop.current = false;
      }}
    >
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginBottom: 12 }}>{title}</h2>
        {children}
      </div>
    </div>,
    document.body,
  );
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
