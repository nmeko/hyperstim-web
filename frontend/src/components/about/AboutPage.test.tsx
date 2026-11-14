import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CONTACT_URL } from "@/components/privacy/PrivacyPage";
import { expectNoAxeViolations } from "@/test/axe";
import AboutPage, { ADVISORS, CONTRIBUTORS, ISSUES_URL, LAB_URL } from "./AboutPage";

describe("AboutPage", () => {
  it("has one H1 and one H2, for getting in touch", () => {
    render(<AboutPage />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("About us");
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["Get in touch"]);
  });

  it("lists the contributors by last name, then the advisor", () => {
    render(<AboutPage />);
    const lastName = ({ name }: { name: string }) => name.split(" ").at(-1)!;
    expect(CONTRIBUTORS.map(lastName)).toEqual([...CONTRIBUTORS.map(lastName)].sort());
    const terms = screen.getAllByRole("term").map((dt) => [dt.textContent, dt.nextElementSibling?.textContent]);
    const newTab = " (opens in a new tab)";
    expect(terms).toEqual([
      ["Contributors", `Shao-Yu Chu${newTab}, Noel Mekogue`],
      ["Advisor", `Haojian Jin${newTab}`],
    ]);
  });

  it("links team members to their personal sites in a new tab, the others as plain text", () => {
    render(<AboutPage />);
    for (const { name, url } of [...CONTRIBUTORS, ...ADVISORS]) {
      const link = screen.queryByRole("link", { name: new RegExp(`^${name}`) });
      if (!url) {
        expect(link).toBeNull();
        continue;
      }
      expect(link).toHaveAttribute("href", url);
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveClass("decoration-dashed");
      expect(link).not.toHaveClass("font-bold", "text-navy");
    }
  });

  it("styles the lab link like the team's, the contact links as text links", () => {
    render(<AboutPage />);
    expect(screen.getByRole("link", { name: /^AI Smith Lab/ })).toHaveClass("decoration-dashed");
    expect(screen.getByRole("link", { name: /^AI Smith Lab/ })).not.toHaveClass("font-bold", "text-navy");
    for (const name of [/^contact form/, /^open an issue on GitHub/]) {
      expect(screen.getByRole("link", { name })).toHaveClass("font-bold", "text-navy");
    }
  });

  it.each([
    [/^AI Smith Lab/, LAB_URL],
    [/^contact form/, CONTACT_URL],
    [/^open an issue on GitHub/, ISSUES_URL],
  ])("opens %s in a new tab", (name, href) => {
    render(<AboutPage />);
    const link = screen.getByRole("link", { name });
    expect(link).toHaveAttribute("href", href);
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("offers the contact form first, then GitHub issues", () => {
    render(<AboutPage />);
    const contact = screen.getByRole("heading", { name: "Get in touch" }).nextElementSibling;
    expect(contact).toHaveTextContent(
      "Questions, corrections or ideas? Please fill out our contact form (opens in a new tab) or open an issue on GitHub (opens in a new tab).",
    );
  });

  it("sets the site's name in bold italic in the text", () => {
    const { container } = render(<AboutPage />);
    const names = [...container.querySelectorAll("p span")].filter((el) => el.textContent === "HyperStim?");
    expect(names).toHaveLength(1);
    expect(names[0]).toHaveClass("font-bold", "italic");
  });

  it("has no accessibility violations", async () => {
    render(<AboutPage />);
    await expectNoAxeViolations();
  });
});
