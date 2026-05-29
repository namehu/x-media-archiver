import { AlertTriangle } from "lucide-react";
import { Button } from "./button";
import { Card, CardContent } from "./card";

export function ErrorState({ title, detail, onRetry }: { title: string; detail?: string; onRetry?: () => void }) {
  return (
    <Card className="border-danger/20">
      <CardContent className="flex items-start gap-3 p-4">
        <div className="rounded-lg bg-danger/10 p-2 text-danger">
          <AlertTriangle className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-fg-primary">{title}</div>
          {detail ? <p className="mt-1 text-sm text-fg-secondary">{detail}</p> : null}
          {onRetry ? (
            <Button className="mt-3" variant="outline" size="sm" onClick={onRetry}>
              Retry
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
