import { render, screen } from "@testing-library/react";
import Link from "next/link";
import { describe, expect, it } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import ChannelName, { channelLabel } from "./ChannelName";

const ID = "UCp5pCAgGmoVQjNwjS5fPVhQ";

describe("ChannelName", () => {
  it("shows the channel's name as it is", () => {
    render(
      <Link href="/channel?id=x">
        <ChannelName name="Science 007" id={ID} />
      </Link>,
    );
    expect(screen.getByRole("link", { name: "Science 007" })).toBeInTheDocument();
    expect(screen.queryByText(ID)).not.toBeInTheDocument();
  });

  it("shows the ID with a Channel ID label when the name is unknown, and names the link so", async () => {
    render(
      <Link href="/channel?id=x">
        <ChannelName name=" " id={ID} />
      </Link>,
    );
    expect(screen.getByRole("link", { name: `Channel ID ${ID}` })).toBeInTheDocument();
    expect(screen.getByText(ID)).toHaveClass("font-mono");
    expect(screen.getByText("Channel ID")).toHaveClass("whitespace-nowrap");
    await expectNoAxeViolations();
  });

  it("says the same in plain text", () => {
    expect(channelLabel("Science 007", ID)).toBe("Science 007");
    expect(channelLabel("", ID)).toBe(`Channel ID ${ID}`);
  });
});
