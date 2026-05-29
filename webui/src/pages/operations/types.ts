import type { Dispatch, SetStateAction } from "react";

export const REQUEUE_STATUSES = ["failed_retryable", "missing", "corrupt", "failed_permanent"];

export type OperationRun = (path: string, actionLabel: string, body?: Record<string, unknown>) => void;

export type StringSetter = Dispatch<SetStateAction<string>>;

export type BooleanSetter = Dispatch<SetStateAction<boolean>>;

export type RequeueStatusesSetter = Dispatch<SetStateAction<string[]>>;
