import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiDelete, type MediaRow } from "../../lib/api";
import { mediaDeleteErrorMessage, type MediaDeleteResponse } from "../../lib/media-deletion";

const SKIP_CONFIRMATION_KEY = "xma:webui:library-delete-confirmation-skipped";

export type LibraryDeleteTarget = {
  kind: "selection" | "preview";
  rows: MediaRow[];
  previewHistoryToken?: string;
};

type DeleteRequest = {
  operationId: string;
  target: LibraryDeleteTarget;
};

export function useLibraryMediaDeletion(
  onDeleted: (response: MediaDeleteResponse, target: LibraryDeleteTarget) => Promise<void>,
) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [skipConfirmation, setSkipConfirmation] = useState(false);
  const [request, setRequest] = useState<DeleteRequest | null>(null);
  const inFlightRef = useRef(false);
  const confirmationOpenRef = useRef(false);
  const mutation = useMutation({
    mutationFn: ({ operationId, target }: DeleteRequest) =>
      apiDelete<MediaDeleteResponse>("/api/v1/library/media", {
        body: {
          operation_id: operationId,
          media_ids: target.rows.map((row) => row.id),
          confirm_physical_delete: true,
        },
      }),
    onSuccess: async (response, completedRequest) => {
      confirmationOpenRef.current = false;
      setDialogOpen(false);
      setRequest(null);
      await onDeleted(response, completedRequest.target);
    },
    onSettled: () => {
      inFlightRef.current = false;
    },
  });

  function execute(nextRequest: DeleteRequest) {
    // React's pending state updates after the event; also guard synchronous re-entry.
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    mutation.mutate(nextRequest);
  }

  function requestDelete(target: LibraryDeleteTarget) {
    if (!target.rows.length || inFlightRef.current || confirmationOpenRef.current) return;
    // Keep the operation ID when explicitly retrying the same failed target.
    const previous = mutation.isError ? mutation.variables : undefined;
    const nextRequest = previous && sameTarget(previous.target, target)
      ? previous
      : { operationId: crypto.randomUUID(), target: { ...target, rows: [...target.rows] } };
    mutation.reset();
    setRequest(nextRequest);
    setSkipConfirmation(false);
    if (readSkipConfirmation()) {
      execute(nextRequest);
    } else {
      confirmationOpenRef.current = true;
      setDialogOpen(true);
    }
  }

  function confirmDelete() {
    if (!request || inFlightRef.current) return;
    if (skipConfirmation) {
      try {
        window.sessionStorage.setItem(SKIP_CONFIRMATION_KEY, "1");
      } catch {
        // This deletion is confirmed, but later requests must still ask if storage fails.
      }
    }
    execute(request);
  }

  return {
    dialogOpen,
    target: request?.target ?? null,
    pending: mutation.isPending,
    error: mutation.error ? mediaDeleteErrorMessage(mutation.error) : null,
    skipConfirmation,
    setSkipConfirmation,
    requestDelete,
    confirmDelete,
    retry: () => {
      if (request) execute(request);
    },
    onDialogOpenChange: (open: boolean) => {
      if (inFlightRef.current) return;
      confirmationOpenRef.current = open;
      setDialogOpen(open);
      if (!open) {
        setRequest(null);
        setSkipConfirmation(false);
        mutation.reset();
      }
    },
  };
}

function readSkipConfirmation() {
  try {
    return window.sessionStorage.getItem(SKIP_CONFIRMATION_KEY) === "1";
  } catch {
    return false;
  }
}

function sameTarget(previous: LibraryDeleteTarget, next: LibraryDeleteTarget) {
  const ids = new Set(previous.rows.map((row) => row.id));
  return previous.kind === next.kind && previous.previewHistoryToken === next.previewHistoryToken &&
    ids.size === next.rows.length && next.rows.every((row) => ids.has(row.id));
}
