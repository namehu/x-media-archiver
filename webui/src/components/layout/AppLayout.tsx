import { NavLink, Outlet } from "react-router-dom";
import { useServerEvents } from "../../hooks/useServerEvents";
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
    items: [{ to: "/operations", labelKey: "nav.operations" }],
  },
];

const themeIcons: Record<Theme, string> = { light: "☀", dark: "☾", auto: "⊙" };
const themeOrder: Theme[] = ["light", "dark", "auto"];

export function AppLayout() {
  const { t, locale, setLocale } = useI18n();
  const { theme, setTheme } = useTheme();
  const events = useServerEvents(["archive_runs", "sources", "source_scans", "worker"]);

  const cycleTheme = () => {
    const next = themeOrder[(themeOrder.indexOf(theme) + 1) % themeOrder.length];
    setTheme(next);
  };

  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar */}
      <aside className="flex w-56 flex-shrink-0 flex-col border-r border-border">
        <div className="px-4 py-5">
          <h1 className="text-sm font-semibold tracking-tight text-foreground">x-media-archiver</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("app.subtitle")}</p>
        </div>
        <nav className="flex-1 space-y-1 px-2 pb-4">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              cn(
                "flex items-center rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground",
                isActive && "bg-muted font-medium text-foreground",
              )
            }
          >
            {t("nav.dashboard")}
          </NavLink>
          <div className="my-2 border-t border-border" />
          {navGroups.map((group) => (
            <div key={group.labelKey} className="pt-2">
              <p className="mb-1 px-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t(group.labelKey)}
              </p>
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground",
                      isActive && "bg-muted font-medium text-foreground",
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
        <header className="flex h-11 flex-shrink-0 items-center justify-between border-b border-border px-4">
          <div
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium",
              events.status === "connected" && "border-primary/30 bg-primary/10 text-primary",
              events.status === "connecting" && "border-border bg-muted text-muted-foreground",
              events.status === "offline" && "border-destructive/30 bg-destructive/10 text-destructive",
            )}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {t(`events.${events.status}`)}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setLocale(locale === "zh" ? "en" : "zh")}
              className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              title={locale === "zh" ? "Switch to English" : "切换为中文"}
            >
              {locale === "zh" ? "EN" : "中文"}
            </button>
            <button
              onClick={cycleTheme}
              className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              title={t(`theme.${theme}`)}
            >
              {themeIcons[theme]}
            </button>
          </div>
        </header>
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
