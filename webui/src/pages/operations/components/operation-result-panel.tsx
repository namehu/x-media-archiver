import type { ActionResponse } from "../../../lib/api";
import { Badge } from "../../../components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { ErrorState } from "../../../components/ui/error-state";
import { actionLabel } from "../../../lib/formatters";
import { errorMessage, resultSummaryItems, textValue } from "../utils";

export function OperationResultPanel({ result, error, isPending }: { result: ActionResponse | null; error: unknown; isPending: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>结果</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? <ErrorState title="最近一次操作失败" detail={errorMessage(error)} /> : null}
        {isPending ? <p className="text-sm text-fg-secondary">运行中...</p> : null}
        {result ? <OperationResultSummary result={result} /> : null}
        {!result && !error && !isPending ? <p className="text-sm text-fg-secondary">还没有执行操作。</p> : null}
      </CardContent>
    </Card>
  );
}

function OperationResultSummary({ result }: { result: ActionResponse }) {
  const items = resultSummaryItems(result);

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border-subtle bg-bg-surface p-3">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Badge tone="default">{textValue(result.status)}</Badge>
          <span className="text-sm font-semibold text-fg-primary">{actionLabel(result.action)}</span>
        </div>
        {items.length ? (
          <dl className="grid gap-2 text-sm md:grid-cols-2 xl:grid-cols-3">
            {items.map((item) => (
              <div key={item.label} className={item.wide ? "md:col-span-2 xl:col-span-3" : undefined}>
                <dt className="text-xs text-fg-secondary">{item.label}</dt>
                <dd className="mt-0.5 break-words font-semibold text-fg-primary">{item.value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-sm text-fg-secondary">没有可摘要展示的字段。</p>
        )}
      </div>
      <details className="rounded-lg border border-border-subtle bg-bg-muted p-3">
        <summary className="cursor-pointer text-sm font-semibold">调试详情</summary>
        <pre className="mt-3 max-h-80 overflow-auto rounded-md bg-bg-elevated p-3 text-xs">{JSON.stringify(result, null, 2)}</pre>
      </details>
    </div>
  );
}
