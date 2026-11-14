import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import SegmentedControl from "./SegmentedControl";

type View = "videos" | "channels" | "categories";
const OPTIONS: { value: View; label: string }[] = [
  { value: "videos", label: "Videos" },
  { value: "channels", label: "Channels" },
  { value: "categories", label: "Categories" },
];

function Controlled({ onChange = () => {} }: { onChange?: (value: View) => void }) {
  const [value, setValue] = useState<View>("videos");
  return (
    <SegmentedControl
      label="Show"
      options={OPTIONS}
      value={value}
      onChange={(v) => {
        setValue(v);
        onChange(v);
      }}
    />
  );
}

describe("SegmentedControl", () => {
  it("is a labeled group with one pressed button per option", () => {
    render(<Controlled />);
    const group = within(screen.getByRole("group", { name: "Show" }));
    expect(group.getAllByRole("button").map((b) => b.textContent)).toEqual(["Videos", "Channels", "Categories"]);
    expect(group.getByRole("button", { name: "Videos" })).toHaveAttribute("aria-pressed", "true");
    expect(group.getByRole("button", { name: "Channels" })).toHaveAttribute("aria-pressed", "false");
    expect(group.getAllByRole("button", { pressed: true })).toHaveLength(1);
  });

  it("gives each pill its own height, as Safari doesn't stretch it to the button", () => {
    render(<Controlled />);
    for (const button of screen.getAllByRole("button")) {
      expect(button).toHaveClass("min-h-11", "p-1");
      expect(button.firstElementChild).toHaveClass("min-h-9");
    }
  });

  it("switches the pressed option on click", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "Categories" }));

    expect(onChange).toHaveBeenCalledWith("categories");
    expect(screen.getByRole("button", { name: "Categories" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Videos" })).toHaveAttribute("aria-pressed", "false");
  });

  it("works from the keyboard: Tab between options, Enter or Space to choose", async () => {
    const user = userEvent.setup();
    render(<Controlled />);

    await user.tab();
    expect(screen.getByRole("button", { name: "Videos" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Channels" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("button", { name: "Channels", pressed: true })).toBeInTheDocument();
    await user.tab();
    await user.keyboard(" ");
    expect(screen.getByRole("button", { name: "Categories", pressed: true })).toBeInTheDocument();
  });

  it("does not submit a surrounding form", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Controlled />
      </form>,
    );
    await user.click(screen.getByRole("button", { name: "Channels" }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<Controlled />);
    await expectNoAxeViolations(container);
  });
});
