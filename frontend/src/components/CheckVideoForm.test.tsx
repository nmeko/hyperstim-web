import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import CheckVideoForm from "./CheckVideoForm";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

beforeEach(() => push.mockReset());

// Empty submit, an invalid link and a valid youtu.be link are covered by CheckVideoCard.test.tsx.
describe("CheckVideoForm", () => {
  it("clears the error as soon as the visitor types again", async () => {
    const user = userEvent.setup();
    render(<CheckVideoForm />);
    const input = screen.getByRole("textbox", { name: "YouTube link or video ID" });

    await user.click(screen.getByRole("button", { name: "Check video" }));
    expect(input).toHaveAttribute("aria-invalid", "true");

    await user.type(input, "d");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByText("Paste a YouTube link or video ID first.")).not.toBeInTheDocument();
  });

  it("keeps a link pasted before the page's script ran", async () => {
    const user = userEvent.setup();
    // The page as built, with a link in the field before React takes it over.
    const container = document.createElement("div");
    container.innerHTML = renderToString(<CheckVideoForm />);
    document.body.append(container);
    screen.getByRole<HTMLInputElement>("textbox", { name: "YouTube link or video ID" }).value = "youtu.be/dQw4w9WgXcQ";
    const root = await act(async () => hydrateRoot(container, <CheckVideoForm />));
    onTestFinished(() => {
      act(() => root.unmount());
      container.remove();
    });

    await user.click(screen.getByRole("button", { name: "Check video" }));
    expect(push).toHaveBeenCalledWith("/video?id=dQw4w9WgXcQ");
    expect(screen.queryByText("Paste a YouTube link or video ID first.")).not.toBeInTheDocument();
  });

  it("announces errors in a live region", async () => {
    const user = userEvent.setup();
    render(<CheckVideoForm />);
    await user.click(screen.getByRole("button", { name: "Check video" }));
    const error = screen.getByText("Paste a YouTube link or video ID first.");
    expect(error).toHaveAttribute("aria-live", "polite");
  });

  it("opens the video page for a bare ID, submitted from the keyboard", async () => {
    const user = userEvent.setup();
    render(<CheckVideoForm />);

    await user.tab();
    expect(screen.getByRole("textbox", { name: "YouTube link or video ID" })).toHaveFocus();
    await user.keyboard("dQw4w9WgXcQ");
    await user.tab();
    expect(screen.getByRole("button", { name: "Check video" })).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(push).toHaveBeenCalledWith("/video?id=dQw4w9WgXcQ");
  });

  it("opens the video page for a full watch link with extra parameters", async () => {
    const user = userEvent.setup();
    render(<CheckVideoForm />);
    await user.type(
      screen.getByRole("textbox", { name: "YouTube link or video ID" }),
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s{Enter}",
    );
    expect(push).toHaveBeenCalledWith("/video?id=dQw4w9WgXcQ");
  });

  it("keeps two forms on one page apart", async () => {
    const user = userEvent.setup();
    render(
      <>
        <CheckVideoForm />
        <CheckVideoForm />
      </>,
    );
    const [first, second] = screen.getAllByRole("textbox", { name: "YouTube link or video ID" });
    const [firstButton] = screen.getAllByRole("button", { name: "Check video" });

    await user.click(firstButton);
    expect(first).toHaveAccessibleDescription("Paste a YouTube link or video ID first.");
    expect(second).not.toHaveAttribute("aria-invalid");
    expect(second).toHaveAccessibleDescription("");
  });

  it("has no accessibility violations", async () => {
    const user = userEvent.setup();
    const { container } = render(<CheckVideoForm />);
    await expectNoAxeViolations(container);
    // Also with an error showing.
    await user.click(screen.getByRole("button", { name: "Check video" }));
    await expectNoAxeViolations(container);
  });
});
