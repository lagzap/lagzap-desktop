import {
  isLatencyOverlayRoute,
  registerBackendLatencyListener,
} from "~/composables/latencySync";

export default defineNuxtPlugin({
  name: "latency",
  dependsOn: ["vuetify"],
  setup() {
    // The pop-out overlay draws from the Go "overview" stream on its own.
    if (isLatencyOverlayRoute()) {
      return;
    }
    const store = useStore();
    registerBackendLatencyListener((latency) => {
      store.applyLatencyUpdate(latency);
    });
  },
});
