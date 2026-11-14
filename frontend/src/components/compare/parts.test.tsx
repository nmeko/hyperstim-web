import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import { Badge } from "./parts";

describe("Badge", () => {
  it("looks the same for both sides, so only the letter tells them apart", () => {
    render(
      <p>
        <Badge side="a" /> <Badge side="b" />
      </p>,
    );
    const a = screen.getByText("A");
    const b = screen.getByText("B");
    expect(a.className).toBe(b.className);
    expect(a).toHaveClass("bg-white", "ring-navy", "text-navy");
  });

  it("gives screen readers the name instead of the letter when given", async () => {
    const { container } = render(
      <p>
        <Badge side="a" sr="Video A" />
      </p>,
    );
    expect(screen.getByText("A")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("Video A")).toHaveClass("sr-only");
    await expectNoAxeViolations(container);
  });
});
