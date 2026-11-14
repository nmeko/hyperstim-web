import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import LinkedRow from "./LinkedRow";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

function renderRow() {
  render(
    <table>
      <tbody>
        <LinkedRow href="/video?id=abc" className="h-16">
          <td>7</td>
          <td className="relative">
            <a href="/video?id=abc">Tiny Trucks</a>
            <a href="/channel?id=chan">Channel</a>
          </td>
          <td>
            <button type="button">About the score</button>
          </td>
        </LinkedRow>
      </tbody>
    </table>,
  );
}

beforeEach(() => {
  push.mockClear();
  window.getSelection()?.removeAllRanges();
});

describe("LinkedRow", () => {
  it("opens its page on a click anywhere in the row", () => {
    renderRow();
    fireEvent.click(screen.getByRole("cell", { name: "7" }));
    expect(push).toHaveBeenCalledWith("/video?id=abc");
  });

  it("leaves clicks on the row's own links and buttons to them", () => {
    renderRow();
    fireEvent.click(screen.getByRole("link", { name: "Channel" }));
    fireEvent.click(screen.getByRole("button", { name: "About the score" }));
    expect(push).not.toHaveBeenCalled();
  });

  it("does nothing with a modifier key or another mouse button, or after selecting text", () => {
    renderRow();
    const cell = screen.getByRole("cell", { name: "7" });
    fireEvent.click(cell, { metaKey: true });
    fireEvent.click(cell, { ctrlKey: true });
    fireEvent.click(cell, { shiftKey: true });
    fireEvent.click(cell, { button: 1 });
    const range = document.createRange();
    range.selectNodeContents(cell);
    window.getSelection()?.addRange(range);
    fireEvent.click(cell);
    expect(push).not.toHaveBeenCalled();
  });

  it("is a plain row to assistive technology, with no accessibility violations", async () => {
    renderRow();
    expect(screen.getByRole("row")).not.toHaveAttribute("tabindex");
    await expectNoAxeViolations();
  });
});
