import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import Select from "./Select";

function Controlled({ onChange = () => {} }: { onChange?: (value: string) => void }) {
  const [value, setValue] = useState("all");
  return (
    <Select
      label="Category"
      value={value}
      onChange={(v) => {
        setValue(v);
        onChange(v);
      }}
    >
      <option value="all">All</option>
      <option value="music">Music</option>
      <option value="gaming">Gaming</option>
    </Select>
  );
}

describe("Select", () => {
  it("is a combobox named by its visible label, showing the current value", () => {
    render(<Controlled />);
    const select = screen.getByRole("combobox", { name: "Category" });
    expect(select).toHaveDisplayValue("All");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["All", "Music", "Gaming"]);
  });

  it("reports the chosen option's value", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);

    await user.selectOptions(screen.getByRole("combobox", { name: "Category" }), "Gaming");

    expect(onChange).toHaveBeenCalledWith("gaming");
    expect(screen.getByRole("combobox", { name: "Category" })).toHaveDisplayValue("Gaming");
  });

  it("is reached with Tab and focused by a click on its label", async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    const select = screen.getByRole("combobox", { name: "Category" });

    await user.tab();
    expect(select).toHaveFocus();
    await user.tab();
    expect(select).not.toHaveFocus();
    await user.click(screen.getByText("Category"));
    expect(select).toHaveFocus();
  });

  it("hides its decorative chevron from assistive technology", () => {
    const { container } = render(<Controlled />);
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<Controlled />);
    await expectNoAxeViolations(container);
  });
});
