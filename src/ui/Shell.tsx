import type { ReactNode } from "react";
import { Icon, type IconName } from "./components/Icon";
import { href, type Route } from "./router";

const TABS: { name: Route["name"]; label: string; icon: IconName; to: Route }[] = [
  { name: "home", label: "Home", icon: "home", to: { name: "home" } },
  { name: "calendar", label: "Calendar", icon: "calendar", to: { name: "calendar", year: null } },
  { name: "progress", label: "Progress", icon: "chart", to: { name: "progress", dayId: null } },
  { name: "settings", label: "Settings", icon: "settings", to: { name: "settings" } },
];

/** Which tab a route belongs to (a session or rest day lives under Home, setup under Settings). */
function tabOf(route: Route): Route["name"] {
  if (route.name === "session" || route.name === "day") return "home";
  if (route.name === "setup" || route.name === "import") return "settings";
  return route.name;
}

export function Shell({ route, children }: { route: Route; children: ReactNode }) {
  const active = tabOf(route);
  return (
    <div className="shell">
      <nav className="tabbar" aria-label="Main">
        <div className="brand">
          <Icon name="barbell" />
          Gym Tracker
        </div>
        {TABS.map((t) => (
          <a key={t.name} className="tab" href={href(t.to)} aria-current={active === t.name ? "page" : undefined}>
            <Icon name={t.icon} />
            {t.label}
          </a>
        ))}
      </nav>
      <main className="shell-main">{children}</main>
    </div>
  );
}
