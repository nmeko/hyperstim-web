import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import ScoreMeter, { filledSegments } from "./ScoreMeter";

describe("filledSegments", () => {
  it("fills one segment per 20 points, at least one", () => {
    expect([0, 1, 20, 21, 45, 81, 100].map(filledSegments)).toEqual([1, 1, 1, 2, 3, 5, 5]);
  });
});

describe("ScoreMeter", () => {
  it("shows the rounded score", () => {
    const { container } = render(<ScoreMeter score={92.6} />);
    expect(screen.getByText("93")).toBeInTheDocument();
    expect(container.querySelector("[data-filled]")).toHaveAttribute("data-filled", "5");
  });

  it("replaces the number with the screen-reader label", () => {
    render(<ScoreMeter score={40} size="compact" srLabel="Higher than 40% of videos" />);
    expect(screen.getByText("40")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("Higher than 40% of videos")).toHaveClass("sr-only");
  });

  it("has no accessibility violations", async () => {
    render(
      <>
        <ScoreMeter score={92.6} />
        <ScoreMeter score={40} size="compact" srLabel="Higher than 40% of videos" />
      </>,
    );
    await expectNoAxeViolations();
  });
});
