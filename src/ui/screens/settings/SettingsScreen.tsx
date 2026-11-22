import { THEMES } from "../../../services/SettingsService";
import { Icon } from "../../components/Icon";
import { ScreenHead, Segmented, Toggle } from "../../components/controls";
import { href } from "../../router";
import { useServices, useSettings, useSyncStatus } from "../../ServicesContext";
import { AccountCard } from "./AccountCard";
import { InstallCard } from "./InstallCard";

const SWATCH: Record<string, [bg: string, accent: string]> = {
  oled: ["#000000", "#c6f432"],
  graphite: ["#1c1c20", "#7db7ff"],
};

export function SettingsScreen() {
  const { settings, backup, sync } = useServices();
  const current = useSettings();
  const status = useSyncStatus();
  const followsAccount = sync.configured && status.email !== null;

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

      <div className="section-title">Appearance</div>
      <div className="card stack">
        <div className="setting">
          <div className="text">
            <div>Color style</div>
            <div className="desc">{THEMES.find((t) => t.key === current.theme)?.description}</div>
            <div className="desc faint">
              {followsAccount ? "Saved to your account, so your other devices match." : sync.configured ? "Sign in to use the same style on all your devices." : "Saved on this device."}
            </div>
          </div>
        </div>
        <Segmented
          label="Color style"
          options={THEMES.map((t) => ({ key: t.key, label: t.label }))}
          value={current.theme}
          onChange={(theme) => settings.update({ theme })}
        />
        <div className="inline small faint">
          {THEMES.map((t) => (
            <span key={t.key} style={{ marginRight: 12 }}>
              <span className="theme-swatch" style={{ background: SWATCH[t.key]![0], boxShadow: `inset -5px 0 0 ${SWATCH[t.key]![1]}` }} />
              {t.label}
            </span>
          ))}
        </div>
        <div className="setting">
          <div className="text">
            <div>Show last session's numbers</div>
            <div className="desc">"last 130 · 8/8/7" under each exercise while logging</div>
          </div>
          <Toggle label="Show last session's numbers" checked={current.showLastSession} onChange={(v) => settings.update({ showLastSession: v })} />
        </div>
      </div>

      <div className="section-title">Workouts</div>
      <div className="list">
        <a className="list-row" href={href({ name: "setup" })}>
          <div className="grow">
            <div className="title">Workout Days and Split</div>
            <div className="meta">Exercises, targets, and which day is which</div>
          </div>
          <Icon name="right" size={18} />
        </a>
        <a className="list-row" href={href({ name: "import" })}>
          <div className="grow">
            <div className="title">Import from Google Sheets</div>
            <div className="meta">Bring in your history from an .xlsx download</div>
          </div>
          <Icon name="right" size={18} />
        </a>
        <button type="button" className="list-row" onClick={() => void download()}>
          <div className="grow">
            <div className="title">Download a backup</div>
            <div className="meta">Everything as a JSON file</div>
          </div>
          <Icon name="download" size={18} />
        </button>
      </div>

      <div className="section-title">Account and sync</div>
      <AccountCard />

      <InstallCard />

      <p className="small faint" style={{ marginTop: 28 }}>
        Gym Tracker v{__APP_VERSION__}
      </p>
    </>
  );
}
