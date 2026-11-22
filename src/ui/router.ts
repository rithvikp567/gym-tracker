import { useEffect, useState } from "react";

/**
 * Hash routes (#/session/…): they work on GitHub Pages without server rewrites and inside
 * the installed app.
 */
export type Route =
  | { name: "home" }
  | { name: "session"; dayId: string; date: string }
  | { name: "calendar"; year: number | null }
  | { name: "progress"; dayId: string | null }
  | { name: "setup" }
  | { name: "settings" }
  | { name: "import" };

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  switch (parts[0]) {
    case "session":
      return parts[1] && parts[2] ? { name: "session", dayId: parts[1], date: parts[2] } : { name: "home" };
    case "calendar":
      return { name: "calendar", year: parts[1] ? Number(parts[1]) : null };
    case "progress":
      return { name: "progress", dayId: parts[1] ?? null };
    case "setup":
      return { name: "setup" };
    case "settings":
      return { name: "settings" };
    case "import":
      return { name: "import" };
    default:
      return { name: "home" };
  }
}

export function href(route: Route): string {
  switch (route.name) {
    case "home":
      return "#/";
    case "session":
      return `#/session/${encodeURIComponent(route.dayId)}/${route.date}`;
    case "calendar":
      return route.year ? `#/calendar/${route.year}` : "#/calendar";
    case "progress":
      return route.dayId ? `#/progress/${encodeURIComponent(route.dayId)}` : "#/progress";
    default:
      return `#/${route.name}`;
  }
}

export function navigate(route: Route, options: { replace?: boolean } = {}): void {
  const target = href(route);
  if (options.replace) {
    history.replaceState(null, "", target);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  } else {
    location.hash = target;
  }
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(location.hash));
  useEffect(() => {
    const onChange = () => {
      setRoute(parseHash(location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}
