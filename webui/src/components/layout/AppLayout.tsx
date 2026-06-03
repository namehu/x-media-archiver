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
import { useTheme, type Theme } from "../../lib/theme";
import { cn } from "../../lib/utils";

const navGroups = [
  {
    labelKey: "运营",
    items: [
      { to: "/queue", label: "归档队列" },
      { to: "/sources", label: "来源" },
    ],
  },
  {
    labelKey: "数据",
    items: [
      { to: "/library", label: "媒体库" },
      { to: "/failures", label: "失败项" },
      { to: "/duplicates", label: "重复媒体" },
    ],
  },
  {
    labelKey: "维护",
    items: [
      { to: "/operations", label: "操作" },
      { to: "/demo", label: "组件预览" },
    ],
  },
];

const themeIcons: Record<Theme, string> = {
  light: "Light",
  dark: "Dark",
  auto: "Auto",
};
const themeOrder: Theme[] = ["light", "dark", "auto"];
const themeLabels: Record<Theme, string> = {
  light: "浅色",
  dark: "深色",
  auto: "跟随系统",
};

export function AppLayout() {
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

  const eventLabel: Record<string, string> = {
    connected: "实时事件已连接",
    connecting: "正在连接实时事件",
    offline: "实时事件离线，使用轮询刷新",
  };

  const commands = useMemo<CommandPaletteItem[]>(
    () => [
      {
        id: "dashboard",
        label: "仪表盘",
        description: "/",
        onSelect: () => navigate("/"),
      },
      {
        id: "library",
        label: "媒体库",
        description: "/library",
        onSelect: () => navigate("/library"),
      },
      {
        id: "queue",
        label: "归档队列",
        description: "/queue",
        onSelect: () => navigate("/queue"),
      },
      {
        id: "sources",
        label: "来源",
        description: "/sources",
        onSelect: () => navigate("/sources"),
      },
      {
        id: "failures",
        label: "失败项",
        description: "/failures",
        onSelect: () => navigate("/failures"),
      },
      {
        id: "duplicates",
        label: "重复媒体",
        description: "/duplicates",
        onSelect: () => navigate("/duplicates"),
      },
      {
        id: "operations",
        label: "操作",
        description: "/operations",
        onSelect: () => navigate("/operations"),
      },
      {
        id: "demo",
        label: "组件预览",
        description: "/demo",
        onSelect: () => navigate("/demo"),
      },
    ],
    [navigate],
  );

  return (
    <div className="flex min-h-screen bg-bg-base text-fg-primary">
      {/* Sidebar */}
      <aside className="flex w-60 flex-shrink-0 flex-col border-r border-border-subtle bg-bg-base">
        <div className="px-4 py-5">
          <h1 className="text-base font-bold tracking-tight text-fg-primary">x-media-archiver</h1>
          <p className="mt-0.5 text-xs text-fg-secondary">本地归档控制台</p>
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
            仪表盘
          </NavLink>
          <Separator className="my-2" />
          {navGroups.map((group) => (
            <div key={group.labelKey} className="pt-2">
              <p className="mb-1 px-2 text-xs font-semibold uppercase text-fg-tertiary">{group.labelKey}</p>
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
                  {item.label}
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
              label={eventLabel[events.status] ?? "离线"}
            />
            <Badge
              tone={healthQuery.isError ? "danger" : writeLockHeld ? "warning" : "secondary"}
              className="hidden md:inline-flex"
            >
              {healthQuery.isError ? "健康详情不可用" : writeLockHeld ? "写操作中" : "空闲"}
            </Badge>
            <Badge tone={queueWork ? "warning" : "secondary"} className="hidden md:inline-flex">
              队列 {queueWork}
            </Badge>
            <Badge tone={activeScans ? "warning" : "secondary"} className="hidden md:inline-flex">
              扫描 {activeScans}
            </Badge>
            <Badge tone={recentErrors ? "danger" : "secondary"} className="hidden md:inline-flex">
              错误 {recentErrors}
            </Badge>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setCommandOpen(true)}
              className="hidden text-xs font-medium md:inline-flex"
              title="打开命令面板"
            >
              搜索
              <span className="ml-2 text-fg-tertiary">⌘K</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={cycleTheme}
              className="text-xs font-medium"
              title={themeLabels[theme]}
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
        placeholder="搜索页面或命令..."
        emptyLabel="没有匹配项"
      />
    </div>
  );
}
