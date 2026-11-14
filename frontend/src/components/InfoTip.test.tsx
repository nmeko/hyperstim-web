import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import InfoTip from "./InfoTip";

function renderTip() {
  render(
    <>
      <InfoTip id="tip" label="About this">
        <p>Helpful text.</p>
      </InfoTip>
      <input aria-label="Field" aria-describedby="tip" />
    </>,
  );
  return { button: screen.getByRole("button", { name: "About this" }), text: screen.getByText("Helpful text.") };
}

afterEach(() => vi.restoreAllMocks());

describe("InfoTip", () => {
  it("shows the text on click and hides it on Escape", async () => {
    const user = userEvent.setup();
    const { button, text } = renderTip();

    expect(text).not.toBeVisible();
    await user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(text).toBeVisible();
    await user.unhover(button);
    expect(text).toBeVisible(); // stays open after a click
    await user.keyboard("{Escape}");
    expect(text).not.toBeVisible();
  });

  it("shows the text while the mouse hovers", async () => {
    const user = userEvent.setup();
    const { button, text } = renderTip();

    await user.hover(button);
    expect(text).toBeVisible();
    await user.unhover(button);
    expect(text).not.toBeVisible();
  });

  it("closes on a click outside", async () => {
    const user = userEvent.setup();
    const { button, text } = renderTip();

    await user.click(button);
    await user.click(screen.getByRole("textbox"));
    expect(text).not.toBeVisible();
  });

  it("describes another element even while closed", () => {
    renderTip();
    expect(screen.getByRole("textbox")).toHaveAccessibleDescription("Helpful text.");
  });

  it("opens below the trigger, or above when there is no room below", async () => {
    const user = userEvent.setup();
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(80);
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect");
    const { button } = renderTip();
    const popover = document.getElementById(button.getAttribute("aria-controls")!)!;

    rect.mockReturnValue({ bottom: 100 } as DOMRect);
    await user.click(button);
    expect(popover).toHaveClass("top-full");

    await user.keyboard("{Escape}");
    rect.mockReturnValue({ bottom: window.innerHeight - 50 } as DOMRect);
    await user.click(button);
    expect(popover).toHaveClass("bottom-full");
  });

  it("shifts sideways to stay 16 px inside the screen", async () => {
    const user = userEvent.setup();
    vi.spyOn(Element.prototype, "clientWidth", "get").mockReturnValue(320);
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect");
    const { button } = renderTip();
    const popover = document.getElementById(button.getAttribute("aria-controls")!)!;
    const open = async (left: number) => {
      rect.mockReturnValue({ bottom: 100, left, right: left + 256 } as DOMRect);
      await user.click(button);
      const translate = popover.style.translate;
      await user.keyboard("{Escape}");
      return translate;
    };

    expect(await open(-8)).toBe("24px 0");
    expect(await open(100)).toBe("-52px 0");
    expect(await open(30)).toBe("");
  });

  it("has no accessibility violations, closed or open", async () => {
    const user = userEvent.setup();
    const { button } = renderTip();
    await expectNoAxeViolations();
    await user.click(button);
    await expectNoAxeViolations();
  });
});
