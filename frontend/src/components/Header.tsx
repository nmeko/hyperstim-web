"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { asset } from "@/lib/asset";

const NAV = [
  { href: "/", label: "Home" },
  { href: "/rankings", label: "Rankings" },
  { href: "/compare", label: "Compare" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/blog", label: "Blog" },
  { href: "/about", label: "About" },
];

function isCurrent(pathname: string, href: string): boolean {
  const path = pathname.replace(/\/$/, "") || "/";
  return href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`);
}

export default function Header() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const menuId = useId();

  // Close the mobile menu after navigating and on Escape.
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const links = NAV.map(({ href, label }) => {
    const current = isCurrent(pathname, href);
    return (
      <li key={href}>
        <Link
          href={href}
          aria-current={current ? "page" : undefined}
          className="flex min-h-11 items-center rounded-md px-3 font-semibold text-navy underline-offset-8 hover:underline hover:decoration-2 aria-[current=page]:underline aria-[current=page]:decoration-2"
        >
          {label}
        </Link>
      </li>
    );
  });

  return (
    <header className="border-b border-navy/10 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <Link href="/" className="shrink-0 rounded-md">
          {/* eslint-disable-next-line @next/next/no-img-element -- static export, images pre-converted */}
          <img
            src={asset("/images/Logo.webp")}
            alt="HyperStim? home"
            width={360}
            height={120}
            className="h-10 w-auto lg:h-12"
          />
        </Link>

        <div className="flex items-center gap-2">
          <nav aria-label="Main" className="hidden lg:block">
            <ul className="flex items-center gap-1">{links}</ul>
          </nav>
          {/* eslint-disable-next-line @next/next/no-img-element -- decorative */}
          <img
            src={asset("/images/sun_1.webp")}
            alt=""
            width={128}
            height={107}
            className="ml-2 hidden h-12 w-auto lg:block"
          />
          <button
            type="button"
            aria-expanded={open}
            aria-controls={menuId}
            onClick={() => setOpen((o) => !o)}
            className="flex min-h-11 items-center gap-2 rounded-full border-2 border-navy px-4 font-semibold text-navy lg:hidden"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
            {open ? "Close menu" : "Menu"}
          </button>
        </div>
      </div>

      <nav
        id={menuId}
        aria-label="Main"
        hidden={!open}
        className="border-t border-navy/10 px-4 pb-3 sm:px-6 lg:hidden"
      >
        <ul className="mx-auto flex max-w-6xl flex-col py-2">{links}</ul>
      </nav>
    </header>
  );
}
