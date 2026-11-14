import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openConsentSettings, saveChoice } from "@/lib/consent";
import { expectNoAxeViolations } from "@/test/axe";
import ConsentBanner from "./ConsentBanner";
import Footer from "./Footer";

const ID = "G-TEST123";
const googleScript = () => document.querySelector('script[src*="googletagmanager.com"]');

function setSignals({ gpc = false, dnt = false } = {}) {
  Object.defineProperty(navigator, "globalPrivacyControl", { value: gpc, configurable: true });
  Object.defineProperty(navigator, "doNotTrack", { value: dnt ? "1" : null, configurable: true });
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_GA_ID", ID);
  setSignals();
  localStorage.clear();
  document.head.innerHTML = "";
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("ConsentBanner", () => {
  it("asks on the first visit and loads nothing from Google before a choice", () => {
    render(<ConsentBanner />);
    expect(screen.getByRole("region", { name: "Cookies on HyperStim?" })).toBeInTheDocument();
    expect(googleScript()).toBeNull();
  });

  it("has no accessibility violations", async () => {
    render(
      <>
        <ConsentBanner />
        <Footer />
      </>,
    );
    await expectNoAxeViolations();
  });

  it("has Accept and Reject with the same look", () => {
    render(<ConsentBanner />);
    const accept = screen.getByRole("button", { name: "Accept" });
    const reject = screen.getByRole("button", { name: "Reject" });
    expect(accept.className).toBe(reject.className);
  });

  it("loads Google's tag once after Accept, and remembers the choice", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<ConsentBanner />);
    await user.click(screen.getByRole("button", { name: "Accept" }));

    expect(screen.queryByRole("region")).toBeNull();
    expect(googleScript()).toHaveAttribute("src", `https://www.googletagmanager.com/gtag/js?id=${ID}`);

    unmount();
    render(<ConsentBanner />);
    expect(screen.queryByRole("region")).toBeNull();
    expect(document.querySelectorAll('script[src*="googletagmanager.com"]')).toHaveLength(1);
  });

  it("loads nothing after Reject, also on the next page", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<ConsentBanner />);
    await user.click(screen.getByRole("button", { name: "Reject" }));
    unmount();
    render(<ConsentBanner />);

    expect(screen.queryByRole("region")).toBeNull();
    expect(googleScript()).toBeNull();
  });

  it("asks again after 12 months", () => {
    saveChoice("accepted", Date.now() - 366 * 24 * 60 * 60 * 1000);
    render(<ConsentBanner />);
    expect(screen.getByRole("region")).toBeInTheDocument();
    expect(googleScript()).toBeNull();
  });

  it.each([{ gpc: true }, { dnt: true }])("treats a privacy signal as Reject: %o", (signals) => {
    setSignals(signals);
    render(<ConsentBanner />);
    expect(screen.queryByRole("region")).toBeNull();
    expect(googleScript()).toBeNull();
  });

  it("does nothing without a GA ID", () => {
    vi.stubEnv("NEXT_PUBLIC_GA_ID", "");
    render(<ConsentBanner />);
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("still works when localStorage is blocked", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const user = userEvent.setup();
    render(<ConsentBanner />);
    await user.click(screen.getByRole("button", { name: "Accept" }));
    expect(googleScript()).not.toBeNull();
  });

  it("reopens from Cookie settings with the current choice and focus", async () => {
    const user = userEvent.setup();
    saveChoice("rejected");
    render(
      <>
        <ConsentBanner />
        <Footer />
      </>,
    );
    expect(screen.queryByRole("region")).toBeNull();

    const settings = screen.getByRole("button", { name: "Cookie settings" });
    await user.click(settings);
    const region = screen.getByRole("region", { name: "Cookies on HyperStim?" });
    expect(region).toHaveTextContent("Your current choice: rejected.");
    expect(region).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Reject" }));
    expect(settings).toHaveFocus();
  });

  it("withdrawing consent deletes Google's cookies and reloads", async () => {
    const user = userEvent.setup();
    const reload = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({ ...window.location, hostname: "localhost", reload });
    saveChoice("accepted");
    render(<ConsentBanner />);
    document.cookie = "_ga=GA1.1.123; path=/";
    document.cookie = "_ga_TEST123=GS1.1.456; path=/";
    document.cookie = "other=1; path=/";

    act(() => openConsentSettings());
    await user.click(screen.getByRole("button", { name: "Reject" }));

    expect(document.cookie).toBe("other=1");
    expect(reload).toHaveBeenCalled();
  });
});

describe("Footer's Cookie settings", () => {
  it("is shown only when there is a choice to make", () => {
    const { unmount } = render(<Footer />);
    expect(screen.getByRole("button", { name: "Cookie settings" })).toBeInTheDocument();
    unmount();

    setSignals({ gpc: true });
    render(<Footer />);
    expect(screen.queryByRole("button", { name: "Cookie settings" })).toBeNull();
  });
});
