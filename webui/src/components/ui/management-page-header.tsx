import type { ReactNode } from "react";

type ManagementPageHeaderProps = {
  title: string;
  description: string;
  eyebrow?: string;
  actions?: ReactNode;
  meta?: ReactNode;
};

export function ManagementPageHeader({
  title,
  description,
  eyebrow,
  actions,
  meta,
}: ManagementPageHeaderProps) {
  return (
    <header className="flex flex-col gap-4 border-b border-border-subtle pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0 max-w-3xl">
        {eyebrow ? <p className="mb-1 text-xs font-semibold text-brand">{eyebrow}</p> : null}
        <h1 className="text-2xl font-bold tracking-tight text-fg-primary">{title}</h1>
        <p className="mt-1 text-sm leading-6 text-fg-secondary">{description}</p>
        {meta ? <div className="mt-3 flex flex-wrap items-center gap-2">{meta}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
