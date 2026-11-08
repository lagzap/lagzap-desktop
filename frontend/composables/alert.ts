import type { LocaleInstance } from "vuetify";
import { useMessagesStore } from "~/stores/messages";
import { getNetworkFailureKind } from "~/utils/httpError";

/** A server code's translation, or the text as it came when there is none. */
export const translateServerMessage = (message: string, locale: LocaleInstance): string => {
  const key = `$vuetify.server_errors.${message.trim()}`;
  const translated = locale.t(key);
  return translated === key ? message : translated;
};

export const displayAlert = (
  text: string,
  color: "error" | "success" | "warning" | "info" | undefined = "info",
  timeout: number = 2000,
) => {
  const messagesStore = useMessagesStore();
  messagesStore.add({ text, color, timeout });
};

/** A message from a successful server response. */
export const displayServerMessage = (
  message: string | undefined,
  locale: LocaleInstance,
  timeout: number = 3000,
) => {
  if (message) {
    displayAlert(translateServerMessage(message, locale), "info", timeout);
  }
};

const STATUS_MESSAGES: Record<number, { key: string; code?: string; fallback: string }> = {
  400: { key: "request_failed", code: "0x00011", fallback: "An error occurred. Code: 0x00011" },
  401: { key: "request_failed", code: "0x00021", fallback: "An error occurred. Code: 0x00021" },
  403: { key: "request_failed", code: "0x00041", fallback: "An error occurred. Code: 0x00041" },
  404: { key: "request_failed", code: "0x00044", fallback: "An error occurred. Code: 0x00044" },
  500: { key: "internal", code: "0x00069", fallback: "Internal server error. Code: 0x00069" },
  501: { key: "not_implemented", code: "0x00079", fallback: "Feature is not implemented yet. Code: 0x00079" },
  502: { key: "request_not_sent", code: "0x00070", fallback: "Request could not be made. Code: 0x00070" },
  503: { key: "unavailable", fallback: "Service is unavailable at the moment, please try again later!" },
  504: { key: "unavailable", fallback: "Service is unavailable at the moment, please try again later!" },
  521: { key: "server_down", fallback: "Server is down, please try again later!" },
};

function networkFailureMessage(
  error: unknown,
  locale: LocaleInstance | undefined
): string | null {
  const kind = getNetworkFailureKind(error);
  if (!kind) {
    return null;
  }
  if (locale) {
    if (kind === "timeout") {
      return locale.t("$vuetify.startService.serverUnreachableTimeout");
    }
    if (kind === "proxy") {
      return locale.t("$vuetify.startService.localProxyNotReady");
    }
    return locale.t("$vuetify.startService.serverUnreachable");
  }
  if (kind === "timeout") {
    return "Can't reach LagZap servers (timed out). Check your internet and try again.";
  }
  if (kind === "proxy") {
    return "Local connection helper is not ready. Retry in a moment.";
  }
  return "Can't reach LagZap servers. Check your internet and try again.";
}

export const getErrorMessage = (error: any, locale: (LocaleInstance) | undefined = undefined) => {
  const networkMsg = networkFailureMessage(error, locale);
  if (networkMsg) {
    return networkMsg;
  }

  const source = error?.value ?? error
  const payload = source?.response?._data ?? source?._data ?? source
  const statusCode = source?.statusCode ?? source?.status ?? source?.response?.status
  let message = payload?.message ?? source?.message ?? source?.cause?.message ?? "An error occurred"
  const code = payload?.code ?? source?.code ?? source?.cause?.code ?? 0

  if (locale !== undefined) {
    const messageKey = typeof message === "string" ? message.trim() : ""
    if (messageKey) {
      const translated = locale.t(`$vuetify.server_errors.${messageKey}`)
      if (translated !== `$vuetify.server_errors.${messageKey}`) {
        return translated
      }
    }
    if (code) {
      const translated = locale.t(`$vuetify.server_errors.${code}`.trim())
      if (translated !== `$vuetify.server_errors.${code}`.trim()) {
        return translated
      }
    }
  }

  const statusMessage = STATUS_MESSAGES[statusCode];
  if (statusMessage) {
    return locale
      ? locale.t(`$vuetify.http_errors.${statusMessage.key}`, statusMessage.code)
      : statusMessage.fallback;
  }

  const rawMessage = typeof message === "string" ? message : ""
  if (rawMessage.includes("<no response>") || rawMessage.includes("FetchError") || !rawMessage || rawMessage === "An error occurred") {
    return locale
      ? locale.t("$vuetify.startService.serverUnreachable")
      : "Can't reach LagZap servers. Check your internet and try again."
  }
  // A code with no translation yet is not for the user to read.
  if (locale && /^[a-z0-9_]+$/.test(rawMessage)) {
    return locale.t("$vuetify.http_errors.unknown")
  }

  return message
};

export const displayError = (error: any, locale: (LocaleInstance) | undefined = undefined) => {
  const message = getErrorMessage(error, locale);
  const messagesStore = useMessagesStore();
  messagesStore.add({ text: message, color: 'error', timeout: 1000 });
};
