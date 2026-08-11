import { Ban, ChevronDown, ExternalLink, History, RefreshCw, RotateCcw } from "lucide-react";
import { Link } from "react-router-dom";
import type { FailureRow } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  getDebugDetailLinkLabel,
  getDebugDetailRoute,
  useDebugRedactionEnabled,
} from "@/lib/debug-redaction";

type FailureRowActionsProps = {
  row: FailureRow;
  pending: boolean;
  onRetry: (tweetId: string) => void;
  onIgnore: (tweetId: string) => void;
  onRestore: (tweetId: string) => void;
  onHistory: (tweetId: string) => void;
};

export function FailureRowActions({ row, pending, onRetry, onIgnore, onRestore, onHistory }: FailureRowActionsProps) {
  const debugRedactionEnabled = useDebugRedactionEnabled();
  const detailRoute = getDebugDetailRoute(debugRedactionEnabled, row.tweet_id);
  const ignored = row.disposition === "ignored";

  return (
    <div className="flex items-center justify-end gap-1" onClick={(event) => event.stopPropagation()}>
      {ignored ? (
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => onRestore(row.tweet_id)}>
          <RotateCcw data-icon="inline-start" />
          恢复
        </Button>
      ) : (
        <Button type="button" size="sm" disabled={pending} onClick={() => onRetry(row.tweet_id)}>
          <RefreshCw data-icon="inline-start" />
          立即重试
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon" aria-label="更多失败项操作" disabled={pending}>
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            {ignored ? (
              <DropdownMenuItem onSelect={() => onRetry(row.tweet_id)}>
                <RefreshCw className="mr-2 size-4" />
                立即重试
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={() => onIgnore(row.tweet_id)}>
                <Ban className="mr-2 size-4" />
                忽略
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => onHistory(row.tweet_id)}>
              <History className="mr-2 size-4" />
              处置记录
            </DropdownMenuItem>
            {detailRoute ? (
              <DropdownMenuItem asChild>
                <Link to={detailRoute}>
                  <ExternalLink className="mr-2 size-4" />
                  Tweet 详情
                </Link>
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem disabled>
                <ExternalLink className="mr-2 size-4" />
                {getDebugDetailLinkLabel(debugRedactionEnabled)}
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
