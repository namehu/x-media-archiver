export class ApiError extends Error {
  status: number;
  code?: string;
  category?: string | null;
  detail?: unknown;

  constructor(status: number, message: string, code?: string, category?: string | null, detail?: unknown) {
    super(`API ${status}: ${message}`);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.category = category;
    this.detail = detail;
  }
}

type ApiErrorPayload = {
  detail?: unknown;
  code?: string;
  message?: string;
  category?: string | null;
};

type ApiRequestOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
};

const API_BASE_URL = (
  (import.meta as ImportMeta & { env?: { VITE_API_BASE_URL?: string } }).env?.VITE_API_BASE_URL ?? ""
).replace(/\/$/, "");

export async function apiGet<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  return apiRequest<T>(path, { ...options, method: "GET" });
}

export async function apiPost<T>(path: string, body: unknown, options: ApiRequestOptions = {}): Promise<T> {
  return apiRequest<T>(path, { ...options, method: "POST", body });
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const response = await fetch(apiUrl(path), buildRequestInit(options));
  if (!response.ok) {
    throw await buildApiError(response);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

function buildRequestInit({ body, headers, ...options }: ApiRequestOptions): RequestInit {
  const requestHeaders = new Headers(headers);
  const init: RequestInit = { ...options, headers: requestHeaders };

  if (body !== undefined) {
    const isFormData = body instanceof FormData;
    const isUrlSearchParams = body instanceof URLSearchParams;
    const isRawBody = typeof body === "string" || isFormData || isUrlSearchParams || body instanceof Blob;

    if (!requestHeaders.has("Content-Type") && !isFormData && !isUrlSearchParams) {
      requestHeaders.set("Content-Type", "application/json");
    }
    init.body = isRawBody ? (body as BodyInit) : JSON.stringify(body);
  }

  return init;
}

export function apiUrl(path: string) {
  if (/^https?:\/\//i.test(path)) return path;
  if (!API_BASE_URL) return path;
  return `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

async function buildApiError(response: Response) {
  const text = await response.text();
  let payload: ApiErrorPayload | null = null;
  try {
    payload = text ? (JSON.parse(text) as ApiErrorPayload) : null;
  } catch (_error) {
    payload = null;
  }
  const message = payload?.message || (typeof payload?.detail === "string" ? payload.detail : text || response.statusText);
  return new ApiError(response.status, message, payload?.code, payload?.category, payload?.detail);
}
