import type { LocaleInstance } from "vuetify";
import { useMessagesStore } from "~/stores/messages";

export const displayAlert = (
  text: string,
  color: "error" | "success" | "warning" | "info" | undefined = "info",
  timeout: number = 2000,
) => {
  const messagesStore = useMessagesStore();
  messagesStore.add({ text, color, timeout });
};

export const getErrorMessage = (error: any, locale: (LocaleInstance) | undefined = undefined) => {
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

  switch (statusCode) {
    case 400:
      message = 'An error occurred. Code: 0x00011'
      break
    case 401:
      message = 'An error occurred. Code: 0x00021'
      break
    case 403:
      message = 'An error occurred. Code: 0x00041'
      break
    case 404:
      message = 'An error occurred. Code: 0x00044'
      break
    case 500:
      message = 'Internal server error. Code: 0x00069'
      break
    case 501:
      message = 'Feature is not implemented yet. Code: 0x00079'
      break
    case 502:
      message = 'Request could not be made. Code: 0x00070'
      break
    case 503:
      message = 'Service is unavailable at the moment, please try again later!'
      break
    case 504:
      message = 'Service is unavailable at the moment, please try again later!'
      break
    case 521:
      message = 'Server is down, please try again later!'
      break
    default: {
      const rawMessage = typeof message === "string" ? message : ""
      if (rawMessage.includes("<no response>") || rawMessage.includes("FetchError")) {
        message = "Network error. Please check your connection."
        break
      }
      if (rawMessage && rawMessage !== "An error occurred") {
        break
      }
      message = "An error occurred. Code: 0x00000"
      break
    }
  }

  return message
};

export const displayError = (error: any, locale: (LocaleInstance) | undefined = undefined) => {
  const message = getErrorMessage(error, locale);
  const messagesStore = useMessagesStore();
  messagesStore.add({ text: message, color: 'error', timeout: 1000 });
};
