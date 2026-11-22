import { ACCENTS, THEMES } from "../../../services/SettingsService";
import { usePageHold } from "../../components/CenterBlock";
import { Icon } from "../../components/Icon";
import { ScreenHead } from "../../components/controls";
import { useViewState } from "../../hooks/useViewState";
import { href } from "../../router";
import { useServices, useSettings } from "../../ServicesContext";
import { AccountCard } from "./AccountCard";
import { InstallCard } from "./InstallCard";
import { LookSettings } from "./LookSettings";

export function SettingsScreen() {
  const { backup } = useServices();

  const download = async () => {
    const json = await backup.exportJson();
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `gym-tracker-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <ScreenHead title="Settings" />

      <div className="section-title">Account and sync</div>
      <AccountCard />

      <div className="section-title">Workouts</div>
      <div className="list">
        <a className="list-row" href={href({ name: "setup" })}>
          <div className="grow">
            <div className="title">Workout Days and Split</div>
          </div>
          <Icon name="right" size={18} />
        </a>
        <a className="list-row" href={href({ name: "import" })}>
          <div className="grow">
            <div className="title">Import from Google Sheets</div>
          </div>
          <Icon name="right" size={18} />
        </a>
        <button type="button" className="list-row" onClick={() => void download()}>
          <div className="grow">
            <div className="title">Download a backup</div>
          </div>
          <Icon name="download" size={18} />
        </button>
      </div>

      <div className="section-title">Appearance</div>
      <AppearanceDropDown />

      <InstallCard />

      <p className="small faint" style={{ marginTop: 28 }}>
        Gym Tracker v{__APP_VERSION__}
      </p>
    </>
  );
}

/** Whether Appearance is open: a view choice, kept until the app closes (like the calendar year). */
export const APPEARANCE_OPEN = "settings.appearanceOpen";

/**
 * Appearance, folded under a drop-down that names the current theme and accent: the same
 * disclosure as Workout Days' cards. Open, the page holds its place (TASKS.md D41), so the
 * header you tapped stays under your finger instead of the page re-centering around it.
 */
function AppearanceDropDown() {
  const current = useSettings();
  const [open, setOpen] = useViewState(APPEARANCE_OPEN, () => false);
  usePageHold(open);
  const theme = current.theme === "custom" ? "Custom" : (THEMES.find((t) => t.key === current.theme)?.label ?? "");
  const accent = current.accent === "custom" ? "Custom" : (ACCENTS.find((a) => a.key === current.accent)?.label ?? "");
  return (
    <section className={`card day-card${open ? " open" : ""}`} aria-label="Appearance">
      <button type="button" className="day-card-head" aria-expanded={open} aria-controls="appearance-body" onClick={() => setOpen(!open)}>
        <span className="grow">
          <span className="title">Theme and accent color</span>
          <span className="meta">{`${theme} theme · ${accent} accent`}</span>
        </span>
        <span className="caret">
          <Icon name="down" size={18} />
        </span>
      </button>
      {open && (
        <div className="day-card-body" id="appearance-body">
          <LookSettings bare />
        </div>
      )}
    </section>
  );
}
