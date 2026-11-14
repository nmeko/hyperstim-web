import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OPEN_EVENT } from "@/lib/consent";
import { expectNoAxeViolations } from "@/test/axe";
import PrivacyPage, { CONTACT_URL } from "./PrivacyPage";

describe("PrivacyPage", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("has one H1, then the sections with their anchors", () => {
    const { container } = render(<PrivacyPage />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Privacy policy");
    const ids = [...container.querySelectorAll("h2")].map((h) => h.id);
    expect(ids).toEqual(["browsing", "checking", "cookies", "your-choices"]);
  });

  it("links to the contact form as “contact us”, in a new tab", () => {
    render(<PrivacyPage />);
    const links = screen.getAllByRole("link", { name: /^contact us/ });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link).toHaveAttribute("href", CONTACT_URL);
      expect(link).toHaveAttribute("target", "_blank");
    }
  });

  it("says in general that we keep logs and count how the site is used", () => {
    render(<PrivacyPage />);
    // Logs and usage counts (plan 014): said in general, not what exactly is logged or counted.
    expect(
      screen.getByText(
        "Our server keeps technical logs to keep the site running and safe, and counts how the site is used to improve it. Neither is used to identify you.",
      ),
    ).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    vi.stubEnv("NEXT_PUBLIC_GA_ID", "G-TEST123");
    render(<PrivacyPage />);
    await expectNoAxeViolations();
  });

  describe("changing the cookie choice", () => {
    it("reopens the banner from “cookie settings” in Your choices", async () => {
      vi.stubEnv("NEXT_PUBLIC_GA_ID", "G-TEST123");
      const opened = vi.fn();
      window.addEventListener(OPEN_EVENT, opened);
      render(<PrivacyPage />);
      await userEvent.setup().click(screen.getByRole("button", { name: "cookie settings" }));
      expect(opened).toHaveBeenCalled();
      window.removeEventListener(OPEN_EVENT, opened);
    });

    it("leaves the sentence out when there is no choice to make", () => {
      render(<PrivacyPage />);
      expect(screen.queryByText(/change your mind about cookies/)).toBeNull();
    });
  });
});
