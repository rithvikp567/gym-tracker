import { useEffect, type ReactNode } from "react";
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

/** Bottom sheet on phones, centered dialog on desktop. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginBottom: 12 }}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function ScreenHead({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="screen-head">
      <div>
        <h1>{title}</h1>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {actions}
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
