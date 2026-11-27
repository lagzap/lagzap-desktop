import { useLocale } from "vuetify";
import type { Connection } from "~/types/monitoring";

/** Connection was rejected: no LagZap server in the profile's location could
 * carry it (LagZap never moves it elsewhere or sends it direct). */
export function isConnectionNotRelayed(connection: Connection): boolean {
  return !!connection.relay_issue?.code;
}

/** Refused outright, not relayed and not sent direct. The plan issues are
 * the exception: those connections go direct out of the chosen internet. */
export function isConnectionBlocked(connection: Connection): boolean {
  const code = connection.relay_issue?.code;
  return !!code && code !== "plan_required" && code !== "plan_locked";
}

/** Tooltip text explaining why a connection was rejected. */
export function useRelayIssueMessage() {
  const { t } = useLocale();
  return (connection: Connection): string => {
    const issue = connection.relay_issue;
    if (!issue?.code) return "";
    switch (issue.code) {
      case "no_route":
        return t("$vuetify.connections.relayIssueNoRoute");
      case "plan_required":
        return t("$vuetify.connections.relayIssuePlanRequired");
      case "plan_locked":
        return t("$vuetify.connections.relayIssuePlanLocked");
      default:
        return issue.detail
          ? t("$vuetify.connections.relayIssueNoRelayAvailableIn", issue.detail)
          : t("$vuetify.connections.relayIssueNoRelayAvailable");
    }
  };
}
