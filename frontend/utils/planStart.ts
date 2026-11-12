/** A plan started while the app runs (a trial granted, a plan bought): the
 * user had none or an expired one ("loading" or "unavailable" is startup,
 * not a change), and now has an active one. Tested in tests/planStarted.test.ts. */
export function planStartedRule(statusBefore: string | null | undefined, activeAfter: boolean | null | undefined): boolean {
  return (statusBefore === "none" || statusBefore === "expired") && !!activeAfter;
}
