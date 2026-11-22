import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { createAppServices } from "./app/AppServices";
import { App } from "./ui/App";
import { startHistory } from "./ui/router";
import { captureInstallPrompt } from "./ui/screens/settings/InstallCard";
import "./ui/theme/tokens.css";
import "./ui/theme/base.css";
import "./ui/theme/app.css";

captureInstallPrompt();
registerSW({ immediate: true });
startHistory();

// Apply the saved theme before first paint to avoid a flash.
try {
  const saved = JSON.parse(localStorage.getItem("gym-tracker.settings") ?? "{}") as { theme?: string };
  if (saved.theme) document.documentElement.dataset.theme = saved.theme;
} catch {
  /* private mode */
}

const root = createRoot(document.getElementById("root")!);

createAppServices()
  .then((services) =>
    root.render(
      <StrictMode>
        <App services={services} />
      </StrictMode>,
    ),
  )
  .catch((error: unknown) => {
    console.error(error);
    root.render(
      <div className="empty">
        <h1>Couldn't open your data</h1>
        <p>{(error as Error).message}</p>
      </div>,
    );
  });
