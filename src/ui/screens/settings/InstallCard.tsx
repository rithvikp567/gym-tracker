import { useEffect, useState } from "react";
import { Icon } from "../../components/Icon";

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();

/** Capture Android/Chrome's install prompt as early as possible (called from main.tsx). */
export function captureInstallPrompt(): void {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    listeners.forEach((l) => l());
  });
}

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isInstalled = () =>
  matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
/** Lesson from Catan Pangea: don't offer installing on computers (mouse/trackpad as main pointer). */
const isComputer = () => matchMedia("(pointer: fine)").matches && !isIos();

/** "Add to Home Screen" so the app opens full-screen without browser bars. */
export function InstallCard() {
  const [, rerender] = useState(0);
  useEffect(() => {
    const l = () => rerender((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);

  if (isInstalled() || isComputer()) return null;

  return (
    <>
      <div className="section-title">Install</div>
      <div className="card stack">
        {deferred ? (
          <button
            type="button"
            className="btn primary"
            onClick={async () => {
              await deferred?.prompt();
              deferred = null;
              rerender((n) => n + 1);
            }}
          >
            <Icon name="download" size={18} /> Install the app
          </button>
        ) : isIos() ? (
          <div className="small muted">
            To get the full-screen app: tap the Share button in Safari, or the menu in Brave, then <b>Add to Home Screen</b>.
          </div>
        ) : (
          <div className="small muted">Use your browser menu's "Install app" or "Add to Home screen".</div>
        )}
      </div>
    </>
  );
}
