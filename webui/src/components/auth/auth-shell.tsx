import type { ReactNode } from "react";
import { Archive, Database, HardDrive, Search } from "lucide-react";

const principles = [
  {
    icon: HardDrive,
    title: "本地保存",
    description: "媒体文件与索引始终由当前实例管理。",
  },
  {
    icon: Database,
    title: "任务可追溯",
    description: "下载、校验与维护操作保留完整记录。",
  },
  {
    icon: Search,
    title: "随时检索",
    description: "从 Tweet、作者与媒体资产快速回到内容。",
  },
];

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-dvh bg-bg-surface lg:grid-cols-[minmax(360px,0.82fr)_1.18fr]">
      <aside
        className="hidden flex-col justify-between border-r border-auth-panel-fg/10 bg-auth-panel p-8 text-auth-panel-fg lg:flex xl:p-12"
        aria-hidden="true"
      >
        <Brand inverse />

        <div className="max-w-md">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-auth-panel-fg/55">Local archive workspace</p>
          <h2 className="mt-4 text-3xl font-semibold leading-tight tracking-tight xl:text-4xl">
            让本地媒体归档保持清晰、可控、可恢复。
          </h2>
          <p className="mt-4 max-w-sm text-sm leading-6 text-auth-panel-fg/65">
            一个面向长期保存的工作台，用于收集、下载、校验与检索你的 X/Twitter 媒体资料。
          </p>

          <div className="mt-10 flex flex-col gap-5 border-t border-auth-panel-fg/10 pt-8">
            {principles.map(({ icon: Icon, title, description }) => (
              <div key={title} className="flex gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-auth-panel-fg/10 bg-auth-panel-fg/[0.06] text-auth-panel-fg/80">
                  <Icon className="size-4" aria-hidden="true" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold">{title}</h2>
                  <p className="mt-1 text-xs leading-5 text-auth-panel-fg/55">{description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="text-xs text-auth-panel-fg/45">Local first · Privacy focused · Auditable</p>
      </aside>

      <section className="flex min-w-0 flex-col">
        <div className="flex p-5 lg:hidden">
          <Brand />
        </div>
        <div className="flex flex-1 items-center justify-center px-4 pb-12 pt-4 sm:px-8 lg:p-12">
          <div className="w-full max-w-[440px]">{children}</div>
        </div>
      </section>
    </main>
  );
}

function Brand({ inverse = false }: { inverse?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex size-10 items-center justify-center rounded-xl bg-brand text-white shadow-2">
        <Archive className="size-5" aria-hidden="true" />
      </div>
      <div>
        <div className={inverse ? "text-sm font-semibold tracking-tight text-auth-panel-fg" : "text-sm font-semibold tracking-tight text-fg-primary"}>
          x-media-archiver
        </div>
        <div className={inverse ? "mt-0.5 text-xs text-auth-panel-fg/50" : "mt-0.5 text-xs text-fg-tertiary"}>
          本地媒体归档工作台
        </div>
      </div>
    </div>
  );
}
