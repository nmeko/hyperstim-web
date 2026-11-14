import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import Chip from "./Chip";

describe("Chip", () => {
  it("is a toggle button named by its content, with its pressed state", () => {
    const { rerender } = render(
      <Chip pressed={false} onClick={() => {}}>
        Gaming
      </Chip>,
    );
    expect(screen.getByRole("button", { name: "Gaming" })).toHaveAttribute("aria-pressed", "false");

    rerender(
      <Chip pressed onClick={() => {}}>
        Gaming
      </Chip>,
    );
    expect(screen.getByRole("button", { name: "Gaming" })).toHaveAttribute("aria-pressed", "true");
  });

  it("calls onClick on click, Enter and Space", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Chip pressed={false} onClick={onClick}>
        Music
      </Chip>,
    );

    await user.click(screen.getByRole("button", { name: "Music" }));
    await user.tab();
    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Music" })).toHaveFocus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(onClick).toHaveBeenCalledTimes(3);
  });

  it("does not submit a surrounding form", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Chip pressed={false} onClick={() => {}}>
          Music
        </Chip>
      </form>,
    );
    await user.click(screen.getByRole("button", { name: "Music" }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <>
        <Chip pressed onClick={() => {}}>
          All
        </Chip>
        <Chip pressed={false} onClick={() => {}}>
          Music
        </Chip>
      </>,
    );
    await expectNoAxeViolations(container);
  });
});
