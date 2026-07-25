export const FORCE_UPDATE_ERROR = "client_version_outdated";

function errorPayload(error: unknown): Record<string, unknown> | null {
  if (!error || typeof error !== "object") {
    return null;
  }
  const err = error as Record<string, unknown>;
  const response = err.response as Record<string, unknown> | undefined;
  const payload = response?._data ?? err._data ?? err;
  return payload && typeof payload === "object"
    ? (payload as Record<string, unknown>)
    : null;
}

/** Flatten nested error fields into one searchable string. */
export function getErrorRawText(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  if (!error || typeof error !== "object") {
    return "";
  }
  const err = error as Record<string, unknown>;
  const payload = errorPayload(error);
  const parts = [
    err.message,
    err.statusMessage,
    err.statusText,
    err.cause && typeof err.cause === "object"
      ? (err.cause as { message?: string }).message
      : err.cause,
    payload?.message,
    (err.response as { statusText?: string } | undefined)?.statusText,
  ];
  return parts
    .filter((part) => typeof part === "string" && part.trim())
    .join(" | ")
    .toLowerCase();
}

export function getErrorCode(error: unknown): string | null {
  if (typeof error === "string") {
    return error.trim() || null;
  }
  const payload = errorPayload(error);
  const message = payload?.message;
  if (typeof message === "string" && message.trim()) {
    return message.trim();
  }
  if (error && typeof error !== "object") {
    return null;
  }
  if (error && typeof error === "object") {
    const err = error as Record<string, unknown>;
    const direct = err.message;
    if (typeof direct === "string" && direct.trim()) {
      return direct.trim();
    }
  }
  return null;
}

export function isForceUpdateError(error: unknown): boolean {
  const code = getErrorCode(error);
  if (code === FORCE_UPDATE_ERROR) {
    return true;
  }
  if (typeof error === "string") {
    return error.includes(FORCE_UPDATE_ERROR);
  }
  if (error && typeof error === "object") {
    const message = String((error as Record<string, unknown>).message ?? "");
    return message.includes(FORCE_UPDATE_ERROR);
  }
  return false;
}

export function getHttpStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  const err = error as Record<string, unknown>;
  const response = err.response as Record<string, unknown> | undefined;

  const status =
    err.statusCode ??
    err.status ??
    response?.status ??
    response?.statusCode;

  return typeof status === "number" && status > 0 ? status : null;
}

export type NetworkFailureKind =
  | "timeout"
  | "unreachable"
  | "proxy"
  | "offline"
  | "unknown";

/** Classify dial/proxy/fetch failures that have no useful HTTP status. */
export function getNetworkFailureKind(error: unknown): NetworkFailureKind | null {
  const text = getErrorRawText(error);
  const name =
    error && typeof error === "object"
      ? String((error as { name?: string }).name ?? "")
      : "";

  if (
    text.includes("i/o timeout") ||
    text.includes("timeout") ||
    text.includes("deadline exceeded") ||
    text.includes("etimedout") ||
    text.includes("context deadline")
  ) {
    return "timeout";
  }
  if (
    text.includes("local auth proxy") ||
    text.includes("localproxy") ||
    text.includes("proxy not ready")
  ) {
    return "proxy";
  }
  if (
    text.includes("no response") ||
    text.includes("fetcherror") ||
    text.includes("network error") ||
    text.includes("econnrefused") ||
    text.includes("econnreset") ||
    text.includes("enotfound") ||
    text.includes("dial tcp") ||
    text.includes("connection refused") ||
    text.includes("network is unreachable") ||
    text.includes("no such host") ||
    text.includes("invalid argument") ||
    name === "FetchError"
  ) {
    return "unreachable";
  }
  if (text.includes("offline") || text.includes("internet")) {
    return "offline";
  }

  // No HTTP status and empty/useless message → treat as unreachable.
  if (getHttpStatus(error) == null) {
    const code = getErrorCode(error);
    if (!code || code === "An error occurred" || /^unknown$/i.test(code)) {
      return "unreachable";
    }
  }
  return null;
}

export function isNetworkFailure(error: unknown): boolean {
  return getNetworkFailureKind(error) != null;
}

export function isAuthHttpStatus(status: number | null): status is 401 | 403 {
  return status === 401 || status === 403;
}

export function isAuthError(error: unknown): boolean {
  if (isForceUpdateError(error)) {
    return false;
  }
  return isAuthHttpStatus(getHttpStatus(error));
}
