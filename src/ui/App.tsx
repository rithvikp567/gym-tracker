import { lazy, Suspense, useLayoutEffect } from "react";
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
import { SocialScreen } from "./screens/social/SocialScreen";
import { SetupScreen } from "./screens/SetupScreen";
import { LookSync } from "./LookSync";
import { ServicesProvider } from "./ServicesContext";
import { Shell } from "./Shell";
import { TimerAlarm } from "./timer/TimerAlarm";

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
    case "social":
      return <SocialScreen />;
    case "settings":
      return <SettingsScreen />;
    case "import":
      return <ImportScreen />;
  }
}

export function App({ services }: { services: AppServices }) {
  const route = useRoute();
  // After each navigation: top of the page, or where you were when going back.
  useLayoutEffect(applyPendingScroll, [route]);
  return (
    <ServicesProvider services={services}>
      <LookSync />
      <TimerAlarm />
      <Shell route={route}>
        <Screen route={route} />
      </Shell>
    </ServicesProvider>
  );
}
