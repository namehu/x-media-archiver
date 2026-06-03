import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiPost, type ActionResponse } from "../../../lib/api";
import { errorMessage } from "../utils";

export function useMaintenanceOps() {
  const queryClient = useQueryClient();
  const [verifyLimit, setVerifyLimit] = useState("");
  const [confirmFullScan, setConfirmFullScan] = useState(false);
  const [requeueStatuses, setRequeueStatuses] = useState(["failed_retryable", "missing", "corrupt"]);
  const [requeueLimit, setRequeueLimit] = useState("");
  const [recoverTimeout, setRecoverTimeout] = useState("");
  const [exportKind, setExportKind] = useState("media");
  const [exportStatus, setExportStatus] = useState("verified");
  const [lastResult, setLastResult] = useState<ActionResponse | null>(null);

  const mutation = useMutation({
    mutationFn: ({ path, body }: { path: string; body: unknown; actionLabel: string }) => apiPost<ActionResponse>(path, body),
    onSuccess: async (result, variables) => {
      setLastResult(result);
      toast.success(`${variables.actionLabel} 已完成`);
      await queryClient.invalidateQueries();
    },
    onError: (error, variables) => {
      toast.error(`${variables.actionLabel} 执行失败：${errorMessage(error)}`);
    },
  });

  return {
    verifyLimit,
    setVerifyLimit,
    confirmFullScan,
    setConfirmFullScan,
    requeueStatuses,
    setRequeueStatuses,
    requeueLimit,
    setRequeueLimit,
    recoverTimeout,
    setRecoverTimeout,
    exportKind,
    setExportKind,
    exportStatus,
    setExportStatus,
    lastResult,
    error: mutation.error,
    isPending: mutation.isPending,
    run: (path: string, actionLabel: string, body: Record<string, unknown> = {}) => {
      mutation.mutate({ path, body, actionLabel });
    },
  };
}
