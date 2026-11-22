import { Icon } from "../../components/Icon";
import { ScreenHead } from "../../components/controls";
import { href } from "../../router";
import { useServices } from "../../ServicesContext";
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

      <div className="section-title">Appearance</div>
      <LookSettings />

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

      <div className="section-title">Account and sync</div>
      <AccountCard />

      <InstallCard />

      <p className="small faint" style={{ marginTop: 28 }}>
        Gym Tracker v{__APP_VERSION__}
      </p>
    </>
  );
}
