import { CheckForUpdates } from "~/bindings/github.com/lagzap/lagzap-desktop/service";

const forceUpdateRequired = ref(false);

export function useForceUpdate() {
  async function handleForceUpdate() {
    forceUpdateRequired.value = true;
    try {
      await CheckForUpdates();
    } catch (error) {
      console.error("force update check failed", error);
    }
  }

  return {
    forceUpdateRequired,
    handleForceUpdate,
  };
}
