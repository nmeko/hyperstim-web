import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import Pagination, { pageWindow } from "./Pagination";

describe("pageWindow", () => {
  it("shows every page up to 9", () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(4, 9)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("keeps 9 slots with gaps", () => {
    expect(pageWindow(1, 655)).toEqual([1, 2, 3, 4, 5, 6, 7, "gap", 655]);
    expect(pageWindow(5, 655)).toEqual([1, 2, 3, 4, 5, 6, 7, "gap", 655]);
    expect(pageWindow(6, 655)).toEqual([1, "gap", 4, 5, 6, 7, 8, "gap", 655]);
    expect(pageWindow(651, 655)).toEqual([1, "gap", 649, 650, 651, 652, 653, 654, 655]);
    expect(pageWindow(650, 655)).toEqual([1, "gap", 648, 649, 650, 651, 652, "gap", 655]);
  });
});

describe("Pagination", () => {
  it("shows nothing for a single page", () => {
    const { container } = render(<Pagination page={1} pageCount={1} onChange={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("changes the page with buttons", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Pagination page={1} pageCount={3} onChange={onChange} />);
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Next page" }));
    await user.click(screen.getByRole("button", { name: "Page 3" }));
    expect(onChange.mock.calls).toEqual([[2], [3]]);
  });

  it("links to each page, with steps that lead nowhere disabled", () => {
    render(<Pagination page={3} pageCount={3} href={(page) => `/p/${page}`} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("link", { name: "Previous page" })).toHaveAttribute("href", "/p/2");
    expect(screen.getByRole("link", { name: "Page 3" })).toHaveAttribute("aria-current", "page");
    const next = screen.getByRole("link", { name: "Next page" });
    expect(next).toHaveAttribute("aria-disabled", "true");
    expect(next).not.toHaveAttribute("href");
  });

  it("has no accessibility violations", async () => {
    render(<Pagination page={2} pageCount={3} href={(page) => `/p/${page}`} />);
    await expectNoAxeViolations();
  });
});
