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

export function getErrorCode(error: unknown): string | null {
  if (typeof error === "string") {
    return error.trim() || null;
  }
  const payload = errorPayload(error);
  const message = payload?.message;
  if (typeof message === "string" && message.trim()) {
    return message.trim();
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

  return typeof status === "number" ? status : null;
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
