import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OPEN_EVENT } from "@/lib/consent";
import { expectNoAxeViolations } from "@/test/axe";
import CookieSettings from "./CookieSettings";

function setSignals({ gpc = false, dnt = false } = {}) {
  Object.defineProperty(navigator, "globalPrivacyControl", { value: gpc, configurable: true });
  Object.defineProperty(navigator, "doNotTrack", { value: dnt ? "1" : null, configurable: true });
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_GA_ID", "G-TEST123");
  setSignals();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// Reopening the banner from the footer is covered end to end in ConsentBanner.test.tsx.
describe("CookieSettings", () => {
  it("asks to reopen the consent banner on click or Enter", async () => {
    const user = userEvent.setup();
    const opened = vi.fn();
    window.addEventListener(OPEN_EVENT, opened);
    render(<CookieSettings className="" />);

    await user.click(screen.getByRole("button", { name: "Cookie settings" }));
    await user.keyboard("{Enter}");
    window.removeEventListener(OPEN_EVENT, opened);

    expect(opened).toHaveBeenCalledTimes(2);
  });

  it("renders nothing without a GA ID, or with Do Not Track on", () => {
    vi.stubEnv("NEXT_PUBLIC_GA_ID", "");
    const { container, unmount } = render(<CookieSettings className="" as="p" before="Change it in " after="." />);
    expect(container).toBeEmptyDOMElement();
    unmount();

    vi.stubEnv("NEXT_PUBLIC_GA_ID", "G-TEST123");
    setSignals({ dnt: true });
    const second = render(<CookieSettings className="" as="li" />);
    expect(second.container).toBeEmptyDOMElement();
  });

  it("wraps the button and its surrounding text in a paragraph, with a custom label", () => {
    render(
      <CookieSettings
        className=""
        label="cookie settings"
        as="p"
        before="You can change your mind at any time in "
        after="."
      />,
    );
    const button = screen.getByRole("button", { name: "cookie settings" });
    expect(button.parentElement?.tagName).toBe("P");
    expect(button.parentElement).toHaveTextContent("You can change your mind at any time in cookie settings.");
  });

  it("wraps the button in a list item for a list", () => {
    render(
      <ul>
        <CookieSettings className="" as="li" />
      </ul>,
    );
    expect(screen.getByRole("listitem")).toContainElement(screen.getByRole("button", { name: "Cookie settings" }));
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <ul>
        <CookieSettings className="" as="li" />
      </ul>,
    );
    await expectNoAxeViolations(container);
  });
});
