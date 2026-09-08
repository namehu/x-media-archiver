import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "../../../components/ui/alert";
import { Button } from "../../../components/ui/button";

export function LibraryDeleteError({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <Alert variant="destructive" className="pointer-events-auto w-full max-w-lg bg-bg-elevated text-left">
      <AlertTriangle />
      <AlertTitle>删除失败</AlertTitle>
      <AlertDescription className="flex flex-col gap-2">
        <span>{error}</span>
        <Button type="button" variant="outline" size="sm" className="self-start" onClick={onRetry}>
          重试删除
        </Button>
      </AlertDescription>
    </Alert>
  );
}
