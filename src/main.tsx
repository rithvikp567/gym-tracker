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
import "./ui/theme/look.css";

captureInstallPrompt();
registerSW({ immediate: true });
startHistory();

// The saved look is painted before the first frame by index.html's head script; LookSync
// (in App) takes over once the settings load.

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
