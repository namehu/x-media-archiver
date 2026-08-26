import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate, useNavigationType } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Archive,
  BarChart3,
  Bug,
  ChevronRight,
  CircleAlert,
  Copy,
  FolderOpen,
  Images,
  LayoutDashboard,
  ListChecks,
  Menu,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Radio,
  Rows3,
  Search,
  Settings2,
  Sun,
  type LucideIcon,
} from "lucide-react";
import { useServerEvents } from "../../hooks/useServerEvents";
import { apiGet, type HealthDetail } from "../../lib/api";
import {
  buildDebuggerSearch,
  persistDebuggerMode,
  resolveDebuggerMode,
  syncDebuggerMode,
} from "../../lib/debugger-mode";
import { isAnyDialogHistoryEntry } from "../../lib/dialog-history";
import { useRuntime } from "../../lib/runtime-provider";
import { useTheme, type Theme } from "../../lib/theme";
import { cn } from "../../lib/utils";
import { AccountMenu } from "../auth/account-menu";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { CommandPalette, type CommandPaletteItem } from "../ui/command-palette";
import { LiveIndicator } from "../ui/live-indicator";
import { Separator } from "../ui/separator";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "../ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { AppScrollContainerProvider } from "./app-scroll-container";

type NavigationItem = {
  to: string;
  label: string;
  icon: LucideIcon;
};

const dashboardNavItem: NavigationItem = { to: "/", label: "仪表盘", icon: LayoutDashboard };

const navGroups: Array<{ label: string; items: NavigationItem[] }> = [
  {
    label: "运营",
    items: [
      { to: "/sources", label: "来源管理", icon: Radio },
      { to: "/queue", label: "归档队列", icon: ListChecks },
    ],
  },
  {
    label: "内容",
    items: [
      { to: "/search", label: "全局搜索", icon: Search },
      { to: "/insights", label: "归档洞察", icon: BarChart3 },
      { to: "/feed", label: "帖子浏览", icon: Rows3 },
      { to: "/library", label: "媒体库", icon: Images },
      { to: "/collections", label: "合集", icon: FolderOpen },
    ],
  },
  {
    label: "治理",
    items: [
      { to: "/failures", label: "失败工作台", icon: CircleAlert },
      { to: "/duplicates", label: "重复媒体", icon: Copy },
      { to: "/operations", label: "系统操作", icon: Settings2 },
    ],
  },
];

const allNavItems = [dashboardNavItem, ...navGroups.flatMap((group) => group.items)];

const themeIcons: Record<Theme, LucideIcon> = {
  light: Sun,
  dark: Moon,
  auto: Monitor,
};
const themeOrder: Theme[] = ["light", "dark", "auto"];
const themeLabels: Record<Theme, string> = {
  light: "浅色",
  dark: "深色",
  auto: "跟随系统",
};
const SIDEBAR_COLLAPSED_KEY = "xma.sidebar-collapsed";

export function AppLayout() {
  const { theme, setTheme } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const [commandOpen, setCommandOpen] = useState(false);
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed);
  const [scrollContainer, setScrollContainer] = useState<HTMLElement | null>(null);
  const events = useServerEvents(["archive_runs", "sources", "source_scans", "worker", "logs", "library"]);
  const runtimeSpeedBps = useRuntime((state) => state.global.speed_bps);
  const runtimeCurrentTweetId = useRuntime((state) => state.global.current_tweet_id);
  const shouldFallbackPoll = shouldUseRuntimePollingFallback(events.status, events.transport);
  const healthQuery = useQuery({
    queryKey: ["health-detail"],
    queryFn: () => apiGet<HealthDetail>("/api/v1/health/detail"),
    refetchInterval: shouldFallbackPoll ? 15000 : false,
  });
  const health = healthQuery.data;
  const writeLockHeld = Boolean(health?.worker.write_lock_held);
  const queueWork = (health?.queue.pending_items ?? 0) + (health?.queue.processing_items ?? 0);
  const activeScans = health?.sources.active_scan_runs ?? 0;
  const recentErrors = health?.recent_errors.length ?? 0;
  const debuggerModeEnabled = resolveDebuggerMode(location.search).enabled;
  const currentPageLabel = resolveCurrentPageLabel(location.pathname);

  useEffect(() => {
    if (!scrollContainer || navigationType === "POP" || isAnyDialogHistoryEntry(location.state)) return;
    scrollContainer.scrollTo({ top: 0 });
  }, [location.key, location.state, navigationType, scrollContainer]);

  const cycleTheme = () => {
    const next = themeOrder[(themeOrder.indexOf(theme) + 1) % themeOrder.length];
    setTheme(next);
  };
  const ThemeIcon = themeIcons[theme];
  const toggleSidebar = () => {
    setSidebarCollapsed((current) => {
      const next = !current;
      persistSidebarCollapsed(next);
      return next;
    });
  };
  const toggleDebuggerMode = () => {
    const nextEnabled = !debuggerModeEnabled;

    persistDebuggerMode(nextEnabled);
    syncDebuggerMode(nextEnabled);
    navigate(
      {
        pathname: location.pathname,
        search: buildDebuggerSearch(location.search, nextEnabled),
        hash: location.hash,
      },
      { replace: true },
    );
  };

  const runtimeStatusLabel = eventLabel(events.status, events.transport);
  const liveState =
    events.status === "connected"
      ? "open"
      : events.status === "connecting" || events.status === "resyncing" || events.status === "reconnecting"
        ? "connecting"
        : "closed";

  const commands = useMemo<CommandPaletteItem[]>(
    () =>
      allNavItems.map((item) => ({
        id: item.to === "/" ? "dashboard" : item.to.slice(1),
        label: item.label,
        description: item.to,
        onSelect: () => navigate(item.to),
      })),
    [navigate],
  );

  return (
    <div className="flex h-dvh overflow-hidden bg-bg-base text-fg-primary">
      <aside
        id="app-sidebar"
        data-collapsed={sidebarCollapsed}
        className={cn(
          "hidden shrink-0 flex-col border-r border-border-subtle bg-bg-base lg:flex",
          sidebarCollapsed ? "w-[72px]" : "w-64",
        )}
      >
        <Navigation collapsed={sidebarCollapsed} onToggle={toggleSidebar} />
      </aside>

      <Sheet open={mobileNavigationOpen} onOpenChange={setMobileNavigationOpen}>
        <SheetContent side="left" className="w-[min(88vw,336px)] p-0 lg:hidden">
          <SheetHeader className="mb-0 border-b border-border-subtle px-5 pb-4 pt-5 text-left">
            <SheetTitle className="flex items-center gap-3">
              <BrandMark />
              <span>
                <span className="block text-sm font-semibold">x-media-archiver</span>
                <span className="mt-0.5 block text-xs font-normal text-fg-tertiary">本地媒体归档工作台</span>
              </span>
            </SheetTitle>
          </SheetHeader>
          <Navigation
            onNavigate={() => setMobileNavigationOpen(false)}
            showBrand={false}
          />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border-subtle bg-bg-base px-3 sm:px-4 lg:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <Button variant="ghost" size="icon" className="lg:hidden" aria-label="打开导航" onClick={() => setMobileNavigationOpen(true)}>
              <Menu aria-hidden="true" />
            </Button>
            <div className="hidden min-w-0 items-center gap-2 text-sm lg:flex">
              <span className="text-fg-tertiary">归档工作台</span>
              <ChevronRight className="size-3.5 text-fg-tertiary" aria-hidden="true" />
              <span className="truncate font-semibold text-fg-primary">{currentPageLabel}</span>
            </div>
            <span className="truncate text-sm font-semibold text-fg-primary sm:hidden">{currentPageLabel}</span>
          </div>

          <div className="flex min-w-0 items-center justify-end gap-1.5">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setCommandOpen(true)}
              className="hidden min-w-52 justify-between font-normal text-fg-secondary md:inline-flex xl:min-w-64"
            >
              <span className="flex items-center gap-2">
                <Search data-icon="inline-start" aria-hidden="true" />
                搜索或跳转
              </span>
              <kbd className="rounded border border-border-subtle bg-bg-base px-1.5 py-0.5 text-[10px] text-fg-tertiary">⌘K</kbd>
            </Button>
            <Button variant="ghost" size="icon" onClick={() => setCommandOpen(true)} className="md:hidden" aria-label="搜索或跳转">
              <Search aria-hidden="true" />
            </Button>

            <Separator orientation="vertical" className="mx-1 hidden h-5 sm:block" />

            <LiveIndicator state={liveState} label={runtimeStatusLabel} compactOnMobile />
            {writeLockHeld ? <Badge tone="warning" className="hidden xl:inline-flex">写操作中</Badge> : null}
            {queueWork ? <Badge tone="warning" className="hidden xl:inline-flex">队列 {queueWork}</Badge> : null}
            {activeScans ? <Badge tone="default" className="hidden 2xl:inline-flex">扫描 {activeScans}</Badge> : null}
            {recentErrors ? <Badge tone="danger" className="hidden xl:inline-flex">错误 {recentErrors}</Badge> : null}
            {runtimeSpeedBps ? <Badge tone="secondary" className="hidden 2xl:inline-flex">{formatBytes(runtimeSpeedBps)}/s</Badge> : null}
            {runtimeCurrentTweetId ? <span className="sr-only">当前 Tweet {runtimeCurrentTweetId}</span> : null}

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={toggleDebuggerMode}
                  className={cn(
                    "hidden text-fg-tertiary hover:text-fg-primary sm:inline-flex",
                    debuggerModeEnabled && "bg-brand-soft text-brand hover:bg-brand-soft hover:text-brand",
                  )}
                  aria-label={debuggerModeEnabled ? "关闭媒体调试模式" : "开启媒体调试模式"}
                >
                  <Bug aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {debuggerModeEnabled ? "媒体调试已开启：隐藏图片和视频" : "媒体调试：隐藏图片和视频"}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={cycleTheme} aria-label={`主题：${themeLabels[theme]}`}>
                  <ThemeIcon aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>主题：{themeLabels[theme]}</TooltipContent>
            </Tooltip>
            <AccountMenu />
          </div>
        </header>

        <main
          ref={setScrollContainer}
          data-app-scroll-container
          className="flex-1 overflow-auto bg-bg-surface px-4 py-5 sm:px-6 sm:py-6 xl:px-8 xl:py-8"
        >
          <AppScrollContainerProvider container={scrollContainer}>
            <div className="mx-auto w-full max-w-[1600px]">
              <Outlet />
            </div>
          </AppScrollContainerProvider>
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

function Navigation({
  onNavigate,
  onToggle,
  showBrand = true,
  collapsed = false,
}: {
  onNavigate?: () => void;
  onToggle?: () => void;
  showBrand?: boolean;
  collapsed?: boolean;
}) {
  const linkClassName = ({ isActive }: { isActive: boolean }) =>
    cn(
      "flex h-10 shrink-0 items-center rounded-lg text-sm font-medium text-fg-secondary transition duration-fast ease-out hover:bg-bg-muted hover:text-fg-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/50",
      collapsed ? "w-10 justify-center p-0" : "gap-3 px-3",
      isActive && "bg-brand-soft text-brand hover:bg-brand-soft hover:text-brand",
    );

  return (
    <>
      {showBrand ? (
        <div className={cn("flex h-14 shrink-0 items-center border-b border-border-subtle", collapsed ? "justify-center px-2" : "gap-3 px-5")}>
          <BrandMark />
          {collapsed ? null : (
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold tracking-tight text-fg-primary">x-media-archiver</div>
              <div className="mt-0.5 text-xs text-fg-tertiary">本地媒体归档工作台</div>
            </div>
          )}
        </div>
      ) : null}

      <nav
        className={cn(
          "flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain py-4",
          collapsed ? "items-center px-2" : "px-3",
        )}
        aria-label="主导航"
      >
        <NavigationLink item={dashboardNavItem} className={linkClassName} onNavigate={onNavigate} collapsed={collapsed} />
        {navGroups.map((group) => (
          <div
            key={group.label}
            className={cn(
              "mt-4 flex flex-col gap-2",
              collapsed && "w-full items-center",
            )}
            role="group"
            aria-label={group.label}
          >
            <div className={cn("flex h-5 shrink-0 items-center", collapsed ? "w-full justify-center" : "px-3")}>
              {collapsed ? (
                <Separator className="w-6" />
              ) : (
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-fg-tertiary">{group.label}</p>
              )}
            </div>
            {group.items.map((item) => (
              <NavigationLink
                key={item.to}
                item={item}
                className={linkClassName}
                onNavigate={onNavigate}
                collapsed={collapsed}
              />
            ))}
          </div>
        ))}
      </nav>

      {onToggle ? (
        <>
          <Separator />
          <div className={cn("p-3", collapsed && "flex justify-center")}>
            {collapsed ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={onToggle}
                    aria-label="展开侧边栏"
                    aria-expanded={false}
                    aria-controls="app-sidebar"
                  >
                    <PanelLeftOpen data-icon="inline-start" aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">展开侧边栏</TooltipContent>
              </Tooltip>
            ) : (
              <Button
                variant="ghost"
                size="md"
                className="w-full justify-start px-3"
                onClick={onToggle}
                aria-label="收起侧边栏"
                aria-expanded={true}
                aria-controls="app-sidebar"
              >
                <PanelLeftClose data-icon="inline-start" aria-hidden="true" />
                收起侧边栏
              </Button>
            )}
          </div>
        </>
      ) : null}
    </>
  );
}

function NavigationLink({
  item,
  className,
  onNavigate,
  collapsed,
}: {
  item: NavigationItem;
  className: ({ isActive }: { isActive: boolean }) => string;
  onNavigate?: () => void;
  collapsed: boolean;
}) {
  const Icon = item.icon;
  const link = (
    <NavLink
      to={item.to}
      end={item.to === "/"}
      className={className}
      onClick={onNavigate}
      aria-label={collapsed ? item.label : undefined}
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      <span className={collapsed ? "sr-only" : "truncate"}>{item.label}</span>
    </NavLink>
  );

  if (!collapsed) return link;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  );
}

function BrandMark() {
  return (
    <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand text-white shadow-2">
      <Archive className="size-5" aria-hidden="true" />
    </div>
  );
}

function resolveCurrentPageLabel(pathname: string) {
  if (pathname.startsWith("/tweets/")) return "Tweet 详情";
  return allNavItems.find((item) => item.to === pathname)?.label ?? "归档工作台";
}

function eventLabel(status: string, transport: string) {
  if (transport === "polling") return status === "connected" ? "REST 快照轮询中" : "REST 快照暂不可用";
  const labels: Record<string, string> = {
    connected: "实时事件已连接",
    connecting: "正在连接实时事件",
    reconnecting: "实时事件正在重连",
    resyncing: "正在同步运行态快照",
    stale: "实时事件无新消息，启用降级刷新",
    offline: "实时事件离线，使用轮询刷新",
  };
  return labels[status] ?? "实时事件离线";
}

function formatBytes(value?: number | null) {
  if (!value || value <= 0) return "-";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function shouldUseRuntimePollingFallback(status: string, transport: string) {
  return transport === "polling" || status === "offline" || status === "reconnecting" || status === "stale";
}

function readSidebarCollapsed() {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

function persistSidebarCollapsed(collapsed: boolean) {
  try {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
}
