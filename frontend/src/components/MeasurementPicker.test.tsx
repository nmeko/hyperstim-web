import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Measure } from "@/components/channel/chart";
import { FEATURE_GROUPS, FEATURE_INFO } from "@/lib/features";
import { expectNoAxeViolations } from "@/test/axe";
import MeasurementPicker from "./MeasurementPicker";

const NAMES = ["Overall", ...FEATURE_GROUPS.flatMap((g) => g.keys.map((k) => FEATURE_INFO[k].name))];

function Controlled({
  wide,
  label,
  onChange = () => {},
}: {
  wide: boolean;
  label?: string;
  onChange?: (measure: Measure) => void;
}) {
  const [value, setValue] = useState<Measure>("overall");
  return (
    <MeasurementPicker
      wide={wide}
      label={label}
      value={value}
      onChange={(m) => {
        setValue(m);
        onChange(m);
      }}
    />
  );
}

describe("MeasurementPicker", () => {
  describe("wide (chips)", () => {
    it("offers Overall and every measurement, under their group titles, with Overall pressed", () => {
      render(<Controlled wide />);
      const group = within(screen.getByRole("group", { name: "Show" }));
      expect(group.getAllByRole("button").map((b) => b.textContent)).toEqual(NAMES);
      expect(NAMES).toHaveLength(13);
      for (const { title } of FEATURE_GROUPS) expect(group.getByText(title)).toBeInTheDocument();
      expect(group.getByRole("button", { name: "Overall" })).toHaveAttribute("aria-pressed", "true");
      expect(group.getAllByRole("button", { pressed: true })).toHaveLength(1);
      expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    });

    it("chooses a measurement by click or keyboard, one pressed at a time", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(<Controlled wide onChange={onChange} />);

      await user.click(screen.getByRole("button", { name: "Loudness jumps" }));
      expect(onChange).toHaveBeenLastCalledWith("loudness_jumps_per_min");
      expect(screen.getByRole("button", { name: "Loudness jumps", pressed: true })).toBeInTheDocument();

      await user.tab();
      await user.keyboard("{Enter}");
      expect(onChange).toHaveBeenLastCalledWith("mean_saturation");
      expect(screen.getAllByRole("button", { pressed: true }).map((b) => b.textContent)).toEqual([
        FEATURE_INFO.mean_saturation.name,
      ]);
    });

    it("uses the given label for its group", () => {
      render(<Controlled wide label="Rank by" />);
      expect(screen.getByRole("group", { name: "Rank by" })).toBeInTheDocument();
    });
  });

  describe("narrow (select)", () => {
    it("offers the same choices in a labeled select, grouped", () => {
      render(<Controlled wide={false} />);
      const select = screen.getByRole("combobox", { name: "Show" });
      expect(select).toHaveDisplayValue("Overall");
      expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(NAMES);
      expect(within(select).getAllByRole("group").map((g) => g.getAttribute("label"))).toEqual(
        FEATURE_GROUPS.map((g) => g.title),
      );
      expect(screen.queryByRole("group", { name: "Show" })).not.toBeInTheDocument();
    });

    it("reports the chosen measurement's key", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(<Controlled wide={false} label="Rank by" onChange={onChange} />);

      const select = screen.getByRole("combobox", { name: "Rank by" });
      await user.selectOptions(select, FEATURE_INFO.motion_frac.name);

      expect(onChange).toHaveBeenCalledWith("motion_frac");
      expect(select).toHaveDisplayValue(FEATURE_INFO.motion_frac.name);
    });
  });

  it("has no accessibility violations, as chips or as a select", async () => {
    const { container, rerender } = render(<Controlled wide />);
    await expectNoAxeViolations(container);
    rerender(<Controlled wide={false} />);
    await expectNoAxeViolations(container);
  });
});
