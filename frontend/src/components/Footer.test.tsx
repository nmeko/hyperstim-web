import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import Footer, { GITHUB_URL } from "./Footer";

describe("Footer", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("links the privacy policy, cookie settings and GitHub, in that order", () => {
    vi.stubEnv("NEXT_PUBLIC_GA_ID", "G-TEST123");
    render(<Footer />);
    const items = within(screen.getByRole("navigation", { name: "Footer" })).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Privacy policy",
      "Cookie settings",
      "GitHub ↗ (opens in a new tab)",
    ]);
  });

  it("opens the repo on GitHub in a new tab", () => {
    render(<Footer />);
    const link = screen.getByRole("link", { name: /^GitHub/ });
    expect(link).toHaveAttribute("href", GITHUB_URL);
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("has no FAQ or About link, as both are in the header", () => {
    render(<Footer />);
    expect(screen.queryByRole("link", { name: "FAQ" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /about/i })).not.toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    vi.stubEnv("NEXT_PUBLIC_GA_ID", "G-TEST123");
    render(<Footer />);
    await expectNoAxeViolations();
  });
});
