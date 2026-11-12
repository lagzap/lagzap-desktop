import { expect, test } from "bun:test";
import { planStartedRule } from "../utils/planStart";

test("a plan that starts while the app runs restarts it; startup does not", () => {
  expect(planStartedRule("none", true)).toBe(true);
  expect(planStartedRule("expired", true)).toBe(true);
  expect(planStartedRule("loading", true)).toBe(false);
  expect(planStartedRule(undefined, true)).toBe(false);
  expect(planStartedRule("unavailable", true)).toBe(false);
  expect(planStartedRule("trial", true)).toBe(false);
  expect(planStartedRule("none", false)).toBe(false);
});
