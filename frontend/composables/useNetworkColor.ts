import { useTheme } from "vuetify";

/** The color of a transport (tcp/udp) everywhere: the latency chart's legend
 * and every connection table. */
export function useNetworkColor() {
  const theme = useTheme();
  return (network?: string): string => {
    const dark = theme.current.value.dark;
    return network === "tcp" ? (dark ? "#64B5F6" : "#1565C0") : dark ? "#81C784" : "#2E7D32";
  };
}
