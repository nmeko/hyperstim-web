import axe from "axe-core";
import { expect } from "vitest";

/**
 * Fails the test on any axe-core accessibility violation in `container` (plan 012).
 * Off here: color contrast (jsdom has no layout or computed colors; the E2E tests check
 * it in a real browser) and "region" (a component on its own isn't inside the page's
 * landmarks).
 */
export async function expectNoAxeViolations(container: Element = document.body) {
  const { violations } = await axe.run(container, {
    rules: { "color-contrast": { enabled: false }, region: { enabled: false } },
  });
  const report = violations.map(
    (v) => `${v.id}: ${v.help}\n${v.nodes.map((n) => `  ${n.target.join(" ")}`).join("\n")}`,
  );
  expect(report, "axe-core violations").toEqual([]);
}
