import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type Ref } from "react";
import { Sheet } from "../../components/controls";
import { formatColor, fromHsva, parseColor, toHsva, type Hsva, type Rgba } from "../../theme/look";

/** Custom properties the stylesheet (look.css) paints with: the colors being picked. */
type Paint = CSSProperties & Record<`--${string}`, string | number>;

/**
 * Pick any color: a wheel (hue around, saturation outward), brightness and opacity sliders,
 * a hex field, and the last few colors picked here. While a finger or the mouse is down on the
 * wheel or a slider, only the picker follows it; letting go applies the color to the page through
 * `onPreview` (this device only), and so does a key press, a typed hex or a recent color. "Use
 * color" hands back the color to save; Cancel, Escape or a tap outside put back what was there.
 * One picker serves the theme and the accent.
 */
export function ColorPicker({
  title,
  initial,
  recent,
  minAlpha,
  shows,
  onPreview,
  onDone,
  onCancel,
}: {
  title: string;
  /** The color it opens with (stored form, `#rrggbb` or `#rrggbbaa`). */
  initial: string;
  /** Colors picked lately, newest first. */
  recent: readonly string[];
  /** The lowest opacity allowed, 0–1 (an accent you can't see would hide every button). */
  minAlpha: number;
  /** The color the page shows for a pick (a theme's background, an accent's fill), for the before / after and recent swatches and the opacity slider. */
  shows: (color: string) => string;
  onPreview: (color: string) => void;
  onDone: (color: string) => void;
  onCancel: () => void;
}) {
  const [hsva, setHsva] = useState<Hsva>(() => start(initial, minAlpha));
  const color = formatColor(fromHsva(hsva));
  const opaque = formatColor(fromHsva({ ...hsva, a: 1 }));
  const touched = useRef(false);
  const wheel = useRef<HTMLDivElement>(null);

  // The page shows a change when you let go (the user's ask: "once they let go on a color apply
  // it immediately"); while you hold, only the wheel, sliders and swatches follow. The first
  // render is what's already showing.
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (touched.current && !held) onPreview(color);
  }, [color, held, onPreview]);
  // Let go anywhere (the pointer can leave the wheel or slider while held) ends the hold.
  const release = useRef<(() => void) | null>(null);
  const hold = useCallback(() => {
    if (release.current) return;
    setHeld(true);
    const end = () => {
      window.removeEventListener("pointerup", end, true);
      window.removeEventListener("pointercancel", end, true);
      release.current = null;
      setHeld(false);
    };
    release.current = end;
    window.addEventListener("pointerup", end, true);
    window.addEventListener("pointercancel", end, true);
  }, []);
  useEffect(
    () => () => {
      if (!release.current) return;
      window.removeEventListener("pointerup", release.current, true);
      window.removeEventListener("pointercancel", release.current, true);
    },
    [],
  );

  const change = (next: Partial<Hsva>) => {
    touched.current = true;
    setHsva((c) => ({ ...c, ...next }));
  };

  // Focus moves into the picker, and back to what opened it afterwards.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    wheel.current?.focus({ preventScroll: true });
    return () => opener?.focus({ preventScroll: true });
  }, []);

  const cancel = useCallback(() => onCancel(), [onCancel]);

  // A tap outside cancels. A press that starts inside and is let go outside (selecting the hex
  // text past the edge) also ends in a click on the backdrop; that one doesn't.
  const pressedInside = useRef(false);
  const inDialog = (target: EventTarget) => (target as Element).closest?.('[role="dialog"]') != null;

  return (
    <div
      className="cp-layer"
      onPointerDownCapture={(e) => (pressedInside.current = inDialog(e.target))}
      onClickCapture={(e) => {
        if (pressedInside.current && !inDialog(e.target)) e.stopPropagation();
      }}
    >
      <Sheet title={title} onClose={cancel}>
        <div className="cp">
          <Wheel ref={wheel} hsva={hsva} opaque={opaque} onHold={hold} onChange={change} />

          <div className="cp-sliders">
            <label className="cp-row">
              <span className="cp-label">Brightness</span>
              <span className="cp-track" style={{ "--track": `linear-gradient(to right, ${formatColor(fromHsva({ ...hsva, v: 0, a: 1 }))}, ${formatColor(fromHsva({ ...hsva, v: 1, a: 1 }))})` } as Paint}>
                <input
                  type="range"
                  className="cp-range"
                  min={0}
                  max={100}
                  value={Math.round(hsva.v * 100)}
                  onPointerDown={hold}
                  onChange={(e) => change({ v: Number(e.target.value) / 100 })}
                  style={{ "--thumb": opaque } as Paint}
                />
              </span>
              <span className="cp-num num">{Math.round(hsva.v * 100)}%</span>
            </label>
            <label className="cp-row">
              <span className="cp-label">Opacity</span>
              {/* From what fully see-through shows (an accent: nothing, over the checkerboard; a theme:
                  plain black or white) to the opaque color, as the page would show it. */}
              <span className="cp-track is-alpha" style={{ "--track": `linear-gradient(to right, ${shows(formatColor({ ...fromHsva(hsva), a: 0 }))}, ${shows(opaque)})` } as Paint}>
                <input
                  type="range"
                  className="cp-range"
                  min={Math.round(minAlpha * 100)}
                  max={100}
                  value={Math.round(hsva.a * 100)}
                  onPointerDown={hold}
                  onChange={(e) => change({ a: Number(e.target.value) / 100 })}
                  style={{ "--thumb": shows(color) } as Paint}
                />
              </span>
              <span className="cp-num num">{Math.round(hsva.a * 100)}%</span>
            </label>
          </div>

          <div className="cp-values">
            <span className="cp-compare" aria-hidden="true">
              <span style={{ "--swatch": shows(initial) } as Paint} />
              <span style={{ "--swatch": shows(color) } as Paint} />
            </span>
            <HexField color={color} onChange={(c) => change(toHsva(c, hsva.h))} keepAlpha={hsva.a} minAlpha={minAlpha} />
          </div>

          {recent.length > 0 && (
            <div className="cp-recent">
              <span className="cp-label">Recent</span>
              <div className="cp-recent-list" role="group" aria-label="Recent colors">
                {recent.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className="cp-recent-color"
                    aria-label={`Use ${c.toUpperCase()}`}
                    title={c.toUpperCase()}
                    aria-pressed={c === color}
                    style={{ "--swatch": shows(c) } as Paint}
                    onClick={() => change(start(c, minAlpha))}
                  />
                ))}
              </div>
            </div>
          )}

          <div className="cp-actions">
            <button type="button" className="btn" onClick={cancel}>
              Cancel
            </button>
            <button type="button" className="btn primary" onClick={() => onDone(color)}>
              Use color
            </button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}

/** The color as hue/saturation/brightness/opacity, with opacity raised to `minAlpha`. */
function start(color: string, minAlpha: number): Hsva {
  const parsed = parseColor(color);
  const c = parsed ? toHsva(parsed) : { h: 0, s: 0, v: 0.5, a: 1 }; // (callers pass stored colors; mid gray if not)
  return { ...c, a: Math.max(minAlpha, c.a) };
}

/**
 * Hue around the wheel (red at the top, clockwise) and saturation outward. Drag with a finger
 * or the mouse (the wheel keeps the pointer while you drag, even off its edge), or use the
 * arrow keys: left / right for hue, up / down for saturation (Shift for bigger steps).
 */
function Wheel({
  ref,
  hsva,
  opaque,
  onHold,
  onChange,
}: {
  ref: Ref<HTMLDivElement>;
  hsva: Hsva;
  opaque: string;
  /** A press began: the page waits for the let-go. */
  onHold: () => void;
  onChange: (next: Partial<Hsva>) => void;
}) {
  // Pointer moves land faster than frames: keep the latest and apply it once per frame.
  const pending = useRef<{ x: number; y: number; el: HTMLElement } | null>(null);
  const frame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const pickAt = (x: number, y: number, el: HTMLElement) => {
    const box = el.getBoundingClientRect();
    const radius = box.width / 2;
    const dx = x - (box.left + radius);
    const dy = y - (box.top + radius);
    const h = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
    const s = Math.min(1, Math.hypot(dx, dy) / radius);
    onChange({ h, s });
  };

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus({ preventScroll: true });
    onHold();
    // Black has no hue to see: touching the wheel brings up enough brightness to show one.
    if (hsva.v < 0.04) onChange({ v: 0.3 });
    pickAt(e.clientX, e.clientY, e.currentTarget);
  };

  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    pending.current = { x: e.clientX, y: e.clientY, el: e.currentTarget };
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const p = pending.current;
      if (p) pickAt(p.x, p.y, p.el);
    });
  };

  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const big = e.shiftKey;
    const hueStep = big ? 15 : 3;
    const satStep = big ? 0.1 : 0.02;
    const moves: Record<string, Partial<Hsva>> = {
      ArrowLeft: { h: (hsva.h - hueStep + 360) % 360 },
      ArrowRight: { h: (hsva.h + hueStep) % 360 },
      ArrowUp: { s: Math.min(1, hsva.s + satStep) },
      ArrowDown: { s: Math.max(0, hsva.s - satStep) },
    };
    const next = moves[e.key];
    if (!next) return;
    e.preventDefault();
    onChange(next);
  };

  const angle = (hsva.h * Math.PI) / 180;
  const x = 50 + 50 * hsva.s * Math.sin(angle);
  const y = 50 - 50 * hsva.s * Math.cos(angle);
  return (
    <div
      ref={ref}
      className="cp-wheel"
      role="slider"
      tabIndex={0}
      aria-label="Hue and saturation"
      aria-valuemin={0}
      aria-valuemax={360}
      aria-valuenow={Math.round(hsva.h)}
      aria-valuetext={`Hue ${Math.round(hsva.h)} degrees, saturation ${Math.round(hsva.s * 100)}%`}
      onPointerDown={down}
      onPointerMove={move}
      onKeyDown={key}
      style={{ "--shade": (1 - hsva.v) * 0.85 } as Paint}
    >
      <span className="cp-thumb" style={{ left: `${x}%`, top: `${y}%`, "--swatch": opaque } as Paint} />
    </div>
  );
}

/**
 * The color as hex. Typing six or eight digits applies at once; three or four (shorthand)
 * apply on Enter or leaving the field. Without alpha digits the opacity stays as it was.
 */
function HexField({
  color,
  onChange,
  keepAlpha,
  minAlpha,
}: {
  color: string;
  onChange: (color: Rgba) => void;
  keepAlpha: number;
  minAlpha: number;
}) {
  const shown = color.slice(0, 7).toUpperCase();
  const [text, setText] = useState(shown);
  const [editing, setEditing] = useState(false);
  const value = editing ? text : shown;

  const apply = (raw: string, partial: boolean) => {
    const digits = raw.trim().replace(/^#/, "");
    if (partial && digits.length !== 6 && digits.length !== 8) return;
    const parsed = parseColor(raw);
    if (!parsed) return;
    const a = digits.length === 8 || digits.length === 4 ? Math.max(minAlpha, parsed.a) : keepAlpha;
    onChange({ ...parsed, a });
  };

  return (
    <label className="cp-hex-label">
      <span className="sr-only">Hex color</span>
      <input
        className="field cp-hex num"
        value={value}
        maxLength={9}
        spellCheck={false}
        autoCapitalize="characters"
        autoComplete="off"
        aria-invalid={editing && parseColor(text) === null}
        onFocus={() => {
          setText(shown);
          setEditing(true);
        }}
        onChange={(e) => {
          setText(e.target.value);
          apply(e.target.value, true);
        }}
        onBlur={() => {
          apply(text, false);
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            apply(text, false);
            setEditing(false);
            e.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}
