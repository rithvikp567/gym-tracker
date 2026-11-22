import { lazy, Suspense, useEffect, useLayoutEffect } from "react";
import type { AppServices } from "../app/AppServices";
import { applyPendingScroll, useRoute, type Route } from "./router";
import { CalendarScreen } from "./screens/CalendarScreen";
import { DayScreen } from "./screens/DayScreen";
import { HomeScreen } from "./screens/HomeScreen";
import { ImportScreen } from "./screens/ImportScreen";

// The chart library only loads when Progress is opened.
const ProgressScreen = lazy(() => import("./screens/progress/ProgressScreen").then((m) => ({ default: m.ProgressScreen })));
import { SessionScreen } from "./screens/session/SessionScreen";
import { SettingsScreen } from "./screens/settings/SettingsScreen";
import { SetupScreen } from "./screens/SetupScreen";
import { ServicesProvider, useSettings } from "./ServicesContext";
import { Shell } from "./Shell";

function Screen({ route }: { route: Route }) {
  switch (route.name) {
    case "home":
      return <HomeScreen />;
    case "session":
      // A fresh screen per workout + date: open rows and notes start closed, and it slides in.
      return <SessionScreen key={`${route.dayId}/${route.date}`} dayId={route.dayId} date={route.date} />;
    case "day":
      return <DayScreen key={route.date} date={route.date} />;
    case "calendar":
      return <CalendarScreen year={route.year} />;
    case "progress":
      return (
        <Suspense fallback={<div className="loading">Loading…</div>}>
          <ProgressScreen dayId={route.dayId} />
        </Suspense>
      );
    case "setup":
      return <SetupScreen key={route.dayId ?? ""} openDayId={route.dayId} />;
    case "settings":
      return <SettingsScreen />;
    case "import":
      return <ImportScreen />;
  }
}

/** Keeps <html data-theme> and the browser's theme color in step with the setting. */
function ThemeSync() {
  const { theme } = useSettings();
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", bg);
  }, [theme]);
  return null;
}

export function App({ services }: { services: AppServices }) {
  const route = useRoute();
  // After each navigation: top of the page, or where you were when going back.
  useLayoutEffect(applyPendingScroll, [route]);
  return (
    <ServicesProvider services={services}>
      <ThemeSync />
      <Shell route={route}>
        <Screen route={route} />
      </Shell>
    </ServicesProvider>
  );
}
