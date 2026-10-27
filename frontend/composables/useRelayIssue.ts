import { useLocale } from "vuetify";
import type { Connection } from "~/types/monitoring";

/** Connection is captured by LagZap but sent straight to the game server. */
export function isConnectionNotRelayed(connection: Connection): boolean {
  const code = connection.relay_issue?.code;
  return !!code && code !== "selection_fallback";
}

/** Tooltip text explaining why a connection is not relayed as configured. */
export function useRelayIssueMessage() {
  const { t } = useLocale();
  return (connection: Connection): string => {
    const issue = connection.relay_issue;
    if (!issue?.code) return "";
    switch (issue.code) {
      case "no_relay_on_the_way":
        return t("$vuetify.connections.relayIssueNoRelayOnTheWay");
      case "no_route":
        return t("$vuetify.connections.relayIssueNoRoute");
      case "selection_fallback":
        return t("$vuetify.connections.relayIssueSelectionFallback", issue.detail ?? "");
      default:
        return issue.detail
          ? t("$vuetify.connections.relayIssueNoRelayAvailableIn", issue.detail)
          : t("$vuetify.connections.relayIssueNoRelayAvailable");
    }
  };
}
