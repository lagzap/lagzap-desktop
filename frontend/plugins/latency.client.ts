import {
  isLatencyOverlayRoute,
  publishLatencyUpdate,
  registerBackendLatencyListener,
  subscribeLatencyBroadcast,
} from "~/composables/latencySync";

export default defineNuxtPlugin({
  name: "latency",
  dependsOn: ["vuetify"],
  setup() {
    const store = useStore();

    if (isLatencyOverlayRoute()) {
      subscribeLatencyBroadcast({
        onSnapshot: (payload) => {
          store.applyLatencySnapshot(payload);
        },
        onUpdate: (latency) => {
          store.applyLatencyUpdate(latency);
        },
      });
      registerBackendLatencyListener((latency) => {
        store.applyLatencyUpdate(latency);
      });
      return;
    }

    registerBackendLatencyListener((latency) => {
      store.applyLatencyUpdate(latency);
      publishLatencyUpdate(latency);
    });
  },
});
