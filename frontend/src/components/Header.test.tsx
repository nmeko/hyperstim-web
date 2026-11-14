import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import Header from "./Header";

const nav = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

/** The phone menu: the nav the menu button controls. */
const phoneMenu = () => {
  const button = screen.getByRole("button", { name: /menu/i });
  return document.getElementById(button.getAttribute("aria-controls")!)!;
};

beforeEach(() => {
  nav.pathname = "/";
});

describe("Header", () => {
  it("links the logo and every page", () => {
    render(<Header />);
    expect(screen.getByRole("link", { name: "HyperStim? home" })).toHaveAttribute("href", "/");
    const desktop = screen.getAllByRole("navigation", { name: "Main" })[0];
    const links = within(desktop).getAllByRole("link");
    expect(links.map((l) => [l.textContent, l.getAttribute("href")])).toEqual([
      ["Home", "/"],
      ["Rankings", "/rankings"],
      ["Compare", "/compare"],
      ["How it works", "/how-it-works"],
      ["Blog", "/blog"],
      ["About", "/about"],
    ]);
  });

  it.each([
    ["/", "Home"],
    ["/rankings", "Rankings"],
    ["/rankings/", "Rankings"],
    ["/compare/x", "Compare"],
    ["/how-it-works", "How it works"],
    ["/blog/", "Blog"],
    ["/blog/page/2/", "Blog"],
    ["/blog/my-first-post/", "Blog"],
    ["/about/", "About"],
  ])("marks %s as the current page under %s", (pathname, label) => {
    nav.pathname = pathname;
    render(<Header />);
    const desktop = screen.getAllByRole("navigation", { name: "Main" })[0];
    const current = within(desktop)
      .getAllByRole("link")
      .filter((l) => l.getAttribute("aria-current") === "page");
    expect(current.map((l) => l.textContent)).toEqual([label]);
  });

  it("marks no page on a page outside the menu", () => {
    nav.pathname = "/video";
    render(<Header />);
    expect(document.querySelectorAll('[aria-current="page"]')).toHaveLength(0);
  });

  it("opens and closes the phone menu with its button", async () => {
    const user = userEvent.setup();
    render(<Header />);
    const button = screen.getByRole("button", { name: "Menu" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(phoneMenu().tagName).toBe("NAV");
    expect(phoneMenu()).toHaveAttribute("aria-label", "Main");
    expect(phoneMenu()).not.toBeVisible();

    await user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(button).toHaveAccessibleName("Close menu");
    expect(phoneMenu()).toBeVisible();

    await user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(phoneMenu()).not.toBeVisible();
  });

  it("closes the phone menu on Escape", async () => {
    const user = userEvent.setup();
    render(<Header />);
    await user.click(screen.getByRole("button", { name: "Menu" }));
    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Menu" })).toHaveAttribute("aria-expanded", "false");
    // Other keys leave it as it is.
    await user.click(screen.getByRole("button", { name: "Menu" }));
    await user.keyboard("a");
    expect(screen.getByRole("button", { name: "Close menu" })).toHaveAttribute("aria-expanded", "true");
  });

  it("closes the phone menu after navigating", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Header />);
    await user.click(screen.getByRole("button", { name: "Menu" }));
    nav.pathname = "/rankings";
    act(() => rerender(<Header />));
    expect(screen.getByRole("button", { name: "Menu" })).toHaveAttribute("aria-expanded", "false");
    expect(within(phoneMenu()).getByText("Rankings")).toHaveAttribute("aria-current", "page");
  });

  it("opens with the keyboard", async () => {
    const user = userEvent.setup();
    render(<Header />);
    await user.tab(); // the logo
    await user.tab(); // the desktop links are in the DOM too
    for (let i = 0; i < 6; i++) await user.tab();
    expect(screen.getByRole("button", { name: "Menu" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(phoneMenu()).toBeVisible();
  });

  // Closed only: jsdom ignores the `lg:` breakpoints, so with the phone menu open both "Main"
  // navs count as shown, which a browser never does at one width.
  it("has no accessibility violations", async () => {
    render(<Header />);
    await expectNoAxeViolations();
  });
});
