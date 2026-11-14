import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import LandAtTitle from "./LandAtTitle";

// Distances from the top of the screen, as the browser would measure them.
const TOPS: Record<string, number> = { title: 100, first: 420, last: 980 };

function renderSection() {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return { top: TOPS[this.id] ?? 0 } as DOMRect;
  });
  render(
    <section>
      <h2 id="title">We measure 12 things</h2>
      <ul id="list">
        <li id="first">Rapid cutting</li>
        <li id="last">Surprise reveals</li>
      </ul>
      <LandAtTitle titleId="title" listId="list" />
    </section>,
  );
  return { first: screen.getByText("Rapid cutting"), last: screen.getByText("Surprise reveals") };
}

// jsdom has no scrolling.
const scroll = vi.fn();
beforeEach(() => {
  scroll.mockClear();
  HTMLElement.prototype.scrollIntoView = scroll;
});

afterEach(() => {
  vi.restoreAllMocks();
  window.location.hash = "";
});

describe("LandAtTitle", () => {
  it("gives each item a scroll margin of its distance below the title plus 16 px", () => {
    const { first, last } = renderSection();
    expect(first.style.scrollMarginTop).toBe("336px");
    expect(last.style.scrollMarginTop).toBe("896px");
  });

  it("scrolls to the item in the address once the margins are set", () => {
    window.location.hash = "#last";
    const { last } = renderSection();
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll.mock.contexts[0]).toBe(last);
    // Marked, as `:target` misses links followed inside the site.
    expect(last).toHaveAttribute("data-linked");
    expect(screen.getByText("Rapid cutting")).not.toHaveAttribute("data-linked");
  });

  it("moves the mark and goes to the new item when only the address's #part changes", () => {
    window.location.hash = "#last";
    const { first, last } = renderSection();
    window.location.hash = "#first";
    fireEvent(window, new HashChangeEvent("hashchange"));
    expect(first).toHaveAttribute("data-linked");
    expect(last).not.toHaveAttribute("data-linked");
    expect(scroll.mock.contexts.at(-1)).toBe(first);
  });

  it("goes back to the item when the page changes size, until the visitor scrolls", () => {
    let resized = () => {};
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resized = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    window.location.hash = "#last";
    renderSection();
    TOPS.title = 60; // something above the section got shorter
    resized();
    expect(screen.getByText("Surprise reveals").style.scrollMarginTop).toBe("936px");
    expect(scroll).toHaveBeenCalledTimes(2);

    fireEvent.wheel(window);
    resized();
    expect(scroll).toHaveBeenCalledTimes(2);
    TOPS.title = 100;
    vi.unstubAllGlobals();
  });

  it("scrolls nowhere without an item in the address", () => {
    renderSection();
    expect(scroll).not.toHaveBeenCalled();
  });

  it("has no accessibility violations", async () => {
    renderSection();
    await expectNoAxeViolations();
  });
});
