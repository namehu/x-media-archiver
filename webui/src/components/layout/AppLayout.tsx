import { NavLink, Outlet } from "react-router-dom";
import { useServerEvents } from "../../hooks/useServerEvents";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../lib/utils";

const navItems = [
  { to: "/", labelKey: "nav.dashboard", end: true },
  { to: "/library", labelKey: "nav.library" },
  { to: "/failures", labelKey: "nav.failures" },
  { to: "/duplicates", labelKey: "nav.duplicates" },
  { to: "/operations", labelKey: "nav.operations" },
  { to: "/queue", labelKey: "nav.queue" },
  { to: "/sources", labelKey: "nav.sources" },
];

export function AppLayout() {
  const { t } = useI18n();
  const events = useServerEvents(["archive_runs", "sources", "source_scans", "worker"]);
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="space-y-2">
            <h1 className="text-xl font-semibold tracking-normal">x-media-archiver</h1>
            <p className="text-sm text-muted-foreground">{t("app.subtitle")}</p>
            <div
              className={cn(
                "inline-flex items-center gap-2 rounded-md border px-2 py-0.5 text-xs font-medium",
                events.status === "connected" && "border-primary/30 bg-primary/10 text-primary",
                events.status === "connecting" && "border-border bg-muted text-muted-foreground",
                events.status === "offline" && "border-destructive/30 bg-destructive/10 text-destructive",
              )}
            >
              <span className="h-2 w-2 rounded-full bg-current" />
              {t(`events.${events.status}`)}
            </div>
          </div>
          <nav className="flex flex-wrap gap-1">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    "rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground",
                    isActive && "bg-muted text-foreground",
                  )
                }
              >
                {t(item.labelKey)}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <Outlet />
      </main>
    </div>
  );
}
