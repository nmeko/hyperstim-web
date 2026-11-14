"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { consentNeeded, openConsentSettings } from "@/lib/consent";

const noSubscribe = () => () => {};

/**
 * "Cookie settings": reopens the consent banner (plan 009). Rendered only in the browser, and only
 * when there is a choice to make (a GA ID is set and no privacy signal is on). `as` wraps the
 * button in a list item (the footer) or a paragraph with text around it (the policy), which are
 * left out along with it.
 */
export default function CookieSettings({
  className,
  label = "Cookie settings",
  as: Wrapper,
  before,
  after,
}: {
  className: string;
  label?: string;
  as?: "li" | "p";
  before?: ReactNode;
  after?: ReactNode;
}) {
  const needed = useSyncExternalStore(noSubscribe, consentNeeded, () => false);
  if (!needed) return null;
  const button = (
    <button type="button" className={className} onClick={openConsentSettings}>
      {label}
    </button>
  );
  if (!Wrapper) return button;
  return (
    <Wrapper>
      {before}
      {button}
      {after}
    </Wrapper>
  );
}
