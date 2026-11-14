import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import ScoreGauge, { needleAngle } from "./ScoreGauge";

function mockReducedMotion(reduce: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: reduce, media: query }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("needleAngle", () => {
  it.each([
    [0, 0],
    [50, 90],
    [100, 180],
    [-5, 0],
    [120, 180],
  ])("points %i at %i°", (score, angle) => {
    expect(needleAngle(score)).toBe(angle);
  });
});

describe("ScoreGauge", () => {
  it("reads one value to screen readers", () => {
    mockReducedMotion(true);
    render(<ScoreGauge score={86.6} />);
    expect(screen.getByText("Stimulation score 87 out of 100")).toBeInTheDocument();
    expect(screen.getByText("87")).toHaveAttribute("aria-hidden", "true");
  });

  it("labels the dial's ends less and more stimulating, centred under each end", () => {
    mockReducedMotion(true);
    const { container } = render(<ScoreGauge score={50} />);
    const labels = [...container.querySelectorAll("[aria-hidden='true'] > span")].filter((s) =>
      s.textContent?.endsWith("stimulating"),
    );
    expect(labels.map((s) => s.textContent)).toEqual(["lessstimulating", "morestimulating"]);
    expect(labels[0]).toHaveClass("left-[10%]", "-translate-x-1/2", "text-center");
    expect(labels[1]).toHaveClass("left-[90%]", "-translate-x-1/2", "text-center");
  });

  it("puts its children after the number, outside the number's centring", () => {
    mockReducedMotion(true);
    render(
      <ScoreGauge score={100}>
        <button type="button">About</button>
      </ScoreGauge>,
    );
    const number = screen.getByText("100", { selector: "span" });
    const button = screen.getByRole("button", { name: "About" });
    expect(number.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(button.parentElement).toHaveClass("absolute", "left-full");
  });

  it("shows the final value at once with reduced motion", () => {
    mockReducedMotion(true);
    const { container } = render(<ScoreGauge score={50} />);
    expect(screen.getByText("50")).toBeInTheDocument();
    expect(container.querySelector("svg")).toHaveAttribute("data-angle", "90");
  });

  it("sweeps from 0 to the score", () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    mockReducedMotion(false);
    const { container } = render(<ScoreGauge score={50} />);
    expect(screen.getByText("0")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1100));
    expect(screen.getByText("50")).toBeInTheDocument();
    expect(container.querySelector("svg")).toHaveAttribute("data-angle", "90");
  });

  it("has no accessibility violations", async () => {
    mockReducedMotion(true);
    render(
      <ScoreGauge score={86.6}>
        <button type="button">About</button>
      </ScoreGauge>,
    );
    await expectNoAxeViolations();
  });
});
