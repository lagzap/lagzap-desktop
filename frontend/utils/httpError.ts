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
  return isAuthHttpStatus(getHttpStatus(error));
}
