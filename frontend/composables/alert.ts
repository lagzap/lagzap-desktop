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
  error = error.value ?? error.response?._data ?? error._data ?? error
  let message = error.data?.message ?? error.message ?? error.cause?.message ?? 'An error occurred'
  if (error.code && locale !== undefined) {
    return locale.t(`$vuetify.server_errors.${error.message}`.trim())
  }
  switch (error.statusCode) {
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
    default:
      message = 'An error occurred. Code: 0x00000'
      if (message.includes('<no response>')) {
        message = 'Network error. Please check your connection.'
      }
      break
  }

  return message
};

export const displayError = (error: any, locale: (LocaleInstance) | undefined = undefined) => {
  const message = getErrorMessage(error, locale);
  const messagesStore = useMessagesStore();
  messagesStore.add({ text: message, color: 'error' });
};
