import { NavLink, Outlet } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useServerEvents } from "../../hooks/useServerEvents";
import { LiveIndicator } from "../ui-next/live-indicator";
import { apiGet, type HealthDetail } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { useTheme, type Theme } from "../../lib/theme";
import { cn } from "../../lib/utils";

const navGroups = [
  {
    labelKey: "nav.group.operations",
    items: [
      { to: "/queue", labelKey: "nav.queue" },
      { to: "/sources", labelKey: "nav.sources" },
    ],
  },
  {
    labelKey: "nav.group.data",
    items: [
      { to: "/library", labelKey: "nav.library" },
      { to: "/failures", labelKey: "nav.failures" },
      { to: "/duplicates", labelKey: "nav.duplicates" },
    ],
  },
  {
    labelKey: "nav.group.maintenance",
    items: [
      { to: "/operations", labelKey: "nav.operations" },
      { to: "/demo", labelKey: "nav.demo" },
    ],
  },
];

const themeIcons: Record<Theme, string> = { light: "Light", dark: "Dark", auto: "Auto" };
const themeOrder: Theme[] = ["light", "dark", "auto"];

export function AppLayout() {
  const { t, locale, setLocale } = useI18n();
  const { theme, setTheme } = useTheme();
  const events = useServerEvents(["archive_runs", "sources", "source_scans", "worker"]);
  const healthQuery = useQuery({
    queryKey: ["health-detail"],
    queryFn: () => apiGet<HealthDetail>("/api/v1/health/detail"),
    refetchInterval: events.status === "connected" ? 30000 : 15000,
  });
  const health = healthQuery.data;
  const writeLockHeld = Boolean(health?.worker.write_lock_held);
  const queueWork = (health?.queue.pending_items ?? 0) + (health?.queue.processing_items ?? 0);
  const activeScans = health?.sources.active_scan_runs ?? 0;
  const recentErrors = health?.recent_errors.length ?? 0;

  const cycleTheme = () => {
    const next = themeOrder[(themeOrder.indexOf(theme) + 1) % themeOrder.length];
    setTheme(next);
  };

  return (
    <div className="flex min-h-screen bg-bg-base text-fg-primary">
      {/* Sidebar */}
      <aside className="flex w-60 flex-shrink-0 flex-col border-r border-border-subtle bg-bg-surface">
        <div className="px-4 py-5">
          <h1 className="text-base font-bold tracking-tight text-fg-primary">x-media-archiver</h1>
          <p className="mt-0.5 text-xs text-fg-secondary">{t("app.subtitle")}</p>
        </div>
        <nav className="flex-1 space-y-1 px-2 pb-4">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              cn(
                "flex items-center rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground",
                "text-fg-secondary transition duration-fast ease-out hover:bg-bg-muted hover:text-fg-primary",
                isActive && "bg-brand-soft font-semibold text-brand",
              )
            }
          >
            {t("nav.dashboard")}
          </NavLink>
          <div className="my-2 border-t border-border-subtle" />
          {navGroups.map((group) => (
            <div key={group.labelKey} className="pt-2">
              <p className="mb-1 px-2 text-xs font-semibold uppercase text-fg-tertiary">
                {t(group.labelKey)}
              </p>
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center rounded-md px-2 py-1.5 text-sm text-fg-secondary transition duration-fast ease-out hover:bg-bg-muted hover:text-fg-primary",
                      isActive && "bg-brand-soft font-semibold text-brand",
                    )
                  }
                >
                  {t(item.labelKey)}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
      </aside>

      {/* Main area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* TopBar */}
        <header className="flex h-12 flex-shrink-0 items-center justify-between gap-3 border-b border-border-subtle bg-bg-elevated px-4">
          <div className="flex min-w-0 items-center gap-2">
            <LiveIndicator
              state={events.status === "connected" ? "open" : events.status === "connecting" ? "connecting" : "closed"}
              label={t(`events.${events.status}`)}
            />
            <StatusPill
              tone={healthQuery.isError ? "danger" : writeLockHeld ? "warning" : "neutral"}
              label={healthQuery.isError ? t("health.unavailable") : writeLockHeld ? t("health.writeLocked") : t("health.idle")}
            />
            <StatusPill label={t("health.queue", { count: queueWork })} tone={queueWork ? "warning" : "neutral"} />
            <StatusPill label={t("health.scans", { count: activeScans })} tone={activeScans ? "warning" : "neutral"} />
            <StatusPill label={t("health.errors", { count: recentErrors })} tone={recentErrors ? "danger" : "neutral"} />
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setLocale(locale === "zh" ? "en" : "zh")}
              className="rounded-md px-2 py-1 text-xs font-medium text-fg-secondary transition hover:bg-bg-muted hover:text-fg-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
              title={locale === "zh" ? "Switch to English" : "切换为中文"}
            >
              {locale === "zh" ? "EN" : "中文"}
            </button>
            <button
              onClick={cycleTheme}
              className="rounded-md px-2 py-1 text-xs font-medium text-fg-secondary transition hover:bg-bg-muted hover:text-fg-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
              title={t(`theme.${theme}`)}
            >
              {themeIcons[theme]}
            </button>
          </div>
        </header>
        <main className="flex-1 overflow-auto bg-bg-base p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function StatusPill({ label, tone = "neutral" }: { label: string; tone?: "neutral" | "warning" | "danger" }) {
  return (
    <span
      className={cn(
        "hidden rounded-md border px-2 py-1 text-xs font-medium md:inline-flex",
        tone === "neutral" && "border-border-subtle bg-bg-muted text-fg-secondary",
        tone === "warning" && "border-warning/25 bg-warning/10 text-warning",
        tone === "danger" && "border-danger/20 bg-danger/10 text-danger",
      )}
    >
      {label}
    </span>
  );
}
