import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { CenterPage } from "./components/CenterBlock";
import { Icon, type IconName } from "./components/Icon";
import { pageOf, tabOf, type TabName } from "./pageLayout";
import { href, type Route } from "./router";

const TABS: { name: TabName; label: string; icon: IconName; to: Route }[] = [
  { name: "home", label: "Home", icon: "home", to: { name: "home" } },
  { name: "calendar", label: "Calendar", icon: "calendar", to: { name: "calendar", year: null } },
  { name: "progress", label: "Progress", icon: "chart", to: { name: "progress", dayId: null } },
  { name: "social", label: "Social", icon: "users", to: { name: "social" } },
  { name: "settings", label: "Settings", icon: "settings", to: { name: "settings" } },
];

/**
 * Phone: the page, with the tab bar floating over the bottom as a rounded tile. Computer: two
 * rounded panels, the rail (Gym Tracker, then the five tabs as square tiles down its length) and
 * the main area. Either way the page's content is centered in its space.
 */
export function Shell({ route, children }: { route: Route; children: ReactNode }) {
  const page = pageOf(route);
  // The first page just appears; every page after it fades in.
  const [firstPage] = useState(page);
  const [moved, setMoved] = useState(false);
  if (!moved && page !== firstPage) setMoved(true);

  // iPhone Safari only shows :active (the tiles' press feedback) once something listens for touches.
  useEffect(() => {
    const noop = () => {};
    document.addEventListener("touchstart", noop, { passive: true });
    return () => document.removeEventListener("touchstart", noop);
  }, []);

  return (
    <div className="shell">
      <nav className="tabbar" aria-label="Main">
        <div className="brand">
          <Icon name="barbell" size={24} />
          <span>Gym Tracker</span>
        </div>
        <TabTiles active={tabOf(route)} />
      </nav>
      <main className="shell-main">
        <CenterPage key={page} page={page} enter={moved}>
          {children}
        </CenterPage>
      </main>
    </div>
  );
}

/**
 * The tabs, with one marker (accent fill and outline) that moves to the current tab, so a
 * tab switch shows where you went. Placed from the tiles' own boxes, so it follows any layout.
 */
function TabTiles({ active }: { active: TabName }) {
  const box = useRef<HTMLDivElement>(null);
  const marker = useRef<HTMLSpanElement>(null);
  const placed = useRef(false);

  useLayoutEffect(() => {
    const container = box.current;
    const m = marker.current;
    if (!container || !m) return;
    const place = (animate: boolean) => {
      const tile = container.querySelector<HTMLElement>('[aria-current="page"]');
      if (!tile) return;
      // Only a tab switch glides; the first placement and a resize (window, phone ↔ rail) jump.
      m.dataset.glide = animate ? "true" : "false";
      // From the boxes as drawn, fractions included: the rail's squares are sized in container
      // units, and whole-pixel offsets left the marker's outline up to a pixel off the tile's.
      const origin = container.getBoundingClientRect();
      const t = tile.getBoundingClientRect();
      m.style.width = `${t.width}px`;
      m.style.height = `${t.height}px`;
      m.style.transform = `translate(${t.left - origin.left - container.clientLeft}px, ${t.top - origin.top - container.clientTop}px)`;
      m.dataset.shown = "true";
    };
    place(placed.current);
    placed.current = true;
    // Only a real resize re-places it (the observer also reports once on start, which would cut
    // the glide that just began short).
    const sizeOf = () => `${container.clientWidth}x${container.clientHeight}`;
    let size = sizeOf();
    const observer = new ResizeObserver(() => {
      if (sizeOf() === size) return;
      size = sizeOf();
      place(false);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [active]);

  return (
    <div className="tabs" ref={box}>
      <span className="tab-marker" ref={marker} aria-hidden />
      {TABS.map((t) => (
        <a key={t.name} className="tab" href={href(t.to)} aria-current={active === t.name ? "page" : undefined}>
          <span className="tab-face">
            <Icon name={t.icon} />
            <span className="tab-label">{t.label}</span>
          </span>
        </a>
      ))}
    </div>
  );
}
