import type { ReactNode } from "react";
import { Card, CardContent } from "./card";

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
        {icon ? <div className="rounded-lg bg-brand-soft p-3 text-brand">{icon}</div> : null}
        <div>
          <div className="font-semibold text-fg-primary">{title}</div>
          {description ? <p className="mt-1 text-sm text-fg-secondary">{description}</p> : null}
        </div>
        {action}
      </CardContent>
    </Card>
  );
}
