import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import CheckVideoCard from "./CheckVideoCard";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

beforeEach(() => push.mockReset());

describe("CheckVideoCard", () => {
  it("asks for input when submitted empty", async () => {
    const user = userEvent.setup();
    render(<CheckVideoCard />);

    await user.click(screen.getByRole("button", { name: /check video/i }));

    expect(screen.getByText("Paste a YouTube link or video ID first.")).toBeInTheDocument();
    expect(screen.getByLabelText("YouTube link or video ID")).toHaveAttribute("aria-invalid", "true");
    expect(push).not.toHaveBeenCalled();
  });

  it("rejects input that is not a YouTube link or ID", async () => {
    const user = userEvent.setup();
    render(<CheckVideoCard />);

    await user.type(screen.getByLabelText("YouTube link or video ID"), "https://example.com{Enter}");

    expect(screen.getByText("That doesn’t look like a YouTube link or video ID.")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("goes to the video page for a valid link", async () => {
    const user = userEvent.setup();
    render(<CheckVideoCard />);

    await user.type(
      screen.getByLabelText("YouTube link or video ID"),
      "https://youtu.be/dQw4w9WgXcQ{Enter}",
    );

    expect(push).toHaveBeenCalledWith("/video?id=dQw4w9WgXcQ");
  });

  it("has no length hint: a check takes about the same time for any length", async () => {
    const user = userEvent.setup();
    render(<CheckVideoCard />);
    const input = screen.getByLabelText("YouTube link or video ID");
    expect(screen.queryByText(/minutes/)).not.toBeInTheDocument();
    // The input is described by its error only.
    await user.type(input, "not a link{Enter}");
    expect(input).toHaveAccessibleDescription("That doesn’t look like a YouTube link or video ID.");
  });

  it("has no accessibility violations, with and without an error", async () => {
    const user = userEvent.setup();
    render(<CheckVideoCard />);
    await expectNoAxeViolations();
    await user.click(screen.getByRole("button", { name: /check video/i }));
    await expectNoAxeViolations();
  });
});
