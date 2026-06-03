import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerEvents } from "../../hooks/useServerEvents";
import { LiveIndicator } from "../ui/live-indicator";
import { CommandPalette, type CommandPaletteItem } from "../ui/command-palette";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Separator } from "../ui/separator";
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

const themeIcons: Record<Theme, string> = {
  light: "Light",
  dark: "Dark",
  auto: "Auto",
};
const themeOrder: Theme[] = ["light", "dark", "auto"];

export function AppLayout() {
  const { t, locale, setLocale } = useI18n();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  const [commandOpen, setCommandOpen] = useState(false);
  const events = useServerEvents(["archive_runs", "sources", "source_scans", "worker", "logs"]);
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
  const commands = useMemo<CommandPaletteItem[]>(
    () => [
      {
        id: "dashboard",
        label: t("nav.dashboard"),
        description: "/",
        onSelect: () => navigate("/"),
      },
      {
        id: "library",
        label: t("nav.library"),
        description: "/library",
        onSelect: () => navigate("/library"),
      },
      {
        id: "queue",
        label: t("nav.queue"),
        description: "/queue",
        onSelect: () => navigate("/queue"),
      },
      {
        id: "sources",
        label: t("nav.sources"),
        description: "/sources",
        onSelect: () => navigate("/sources"),
      },
      {
        id: "failures",
        label: t("nav.failures"),
        description: "/failures",
        onSelect: () => navigate("/failures"),
      },
      {
        id: "duplicates",
        label: t("nav.duplicates"),
        description: "/duplicates",
        onSelect: () => navigate("/duplicates"),
      },
      {
        id: "operations",
        label: t("nav.operations"),
        description: "/operations",
        onSelect: () => navigate("/operations"),
      },
      {
        id: "demo",
        label: t("nav.demo"),
        description: "/demo",
        onSelect: () => navigate("/demo"),
      },
    ],
    [navigate, t],
  );

  return (
    <div className="flex min-h-screen bg-bg-base text-fg-primary">
      {/* Sidebar */}
      <aside className="flex w-60 flex-shrink-0 flex-col border-r border-border-subtle bg-bg-base">
        <div className="px-4 py-5">
          <h1 className="text-base font-bold tracking-tight text-fg-primary">x-media-archiver</h1>
          <p className="mt-0.5 text-xs text-fg-secondary">{t("app.subtitle")}</p>
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-2 pb-4">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              cn(
                "flex items-center rounded-md px-2 py-1.5 text-sm text-fg-secondary transition duration-fast ease-out hover:bg-bg-muted hover:text-fg-primary",
                isActive && "bg-brand-soft font-semibold text-brand",
              )
            }
          >
            {t("nav.dashboard")}
          </NavLink>
          <Separator className="my-2" />
          {navGroups.map((group) => (
            <div key={group.labelKey} className="pt-2">
              <p className="mb-1 px-2 text-xs font-semibold uppercase text-fg-tertiary">{t(group.labelKey)}</p>
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
        <header className="flex h-12 flex-shrink-0 items-center justify-between gap-3 border-b border-border-subtle bg-bg-base px-4">
          <div className="flex min-w-0 items-center gap-2">
            <LiveIndicator
              state={events.status === "connected" ? "open" : events.status === "connecting" ? "connecting" : "closed"}
              label={t(`events.${events.status}`)}
            />
            <Badge
              tone={healthQuery.isError ? "danger" : writeLockHeld ? "warning" : "secondary"}
              className="hidden md:inline-flex"
            >
              {healthQuery.isError
                ? t("health.unavailable")
                : writeLockHeld
                  ? t("health.writeLocked")
                  : t("health.idle")}
            </Badge>
            <Badge tone={queueWork ? "warning" : "secondary"} className="hidden md:inline-flex">
              {t("health.queue", { count: queueWork })}
            </Badge>
            <Badge tone={activeScans ? "warning" : "secondary"} className="hidden md:inline-flex">
              {t("health.scans", { count: activeScans })}
            </Badge>
            <Badge tone={recentErrors ? "danger" : "secondary"} className="hidden md:inline-flex">
              {t("health.errors", { count: recentErrors })}
            </Badge>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setCommandOpen(true)}
              className="hidden text-xs font-medium md:inline-flex"
              title={t("command.open")}
            >
              {t("command.search")}
              <span className="ml-2 text-fg-tertiary">⌘K</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLocale(locale === "zh" ? "en" : "zh")}
              className="text-xs font-medium"
              title={locale === "zh" ? "Switch to English" : "切换为中文"}
            >
              {locale === "zh" ? "EN" : "中文"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={cycleTheme}
              className="text-xs font-medium"
              title={t(`theme.${theme}`)}
            >
              {themeIcons[theme]}
            </Button>
          </div>
        </header>
        <main className="flex-1 overflow-auto bg-bg-surface p-6">
          <Outlet />
        </main>
      </div>
      <CommandPalette
        open={commandOpen}
        onOpenChange={setCommandOpen}
        commands={commands}
        placeholder={t("command.placeholder")}
        emptyLabel={t("command.empty")}
      />
    </div>
  );
}
