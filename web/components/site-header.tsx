"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// The site's top navigation. A client component only to mark the current page
// (aria-current), which needs the path.

export const NAV_LINKS = [
  { href: "/judge", label: "Judge" },
  { href: "/live", label: "Live" },
  { href: "/verify", label: "Verify" },
  { href: "/proof", label: "Proof" },
  { href: "/trust", label: "Trust" },
] as const;

export function SiteHeader() {
  const pathname = usePathname();
  return (
    <header className="border-b-3 border-ink">
      <nav
        aria-label="Main"
        className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-4 sm:px-6"
      >
        <Link href="/" className="font-display text-2xl font-extrabold tracking-display" aria-current={pathname === "/" ? "page" : undefined}>
          LOKA Pay
        </Link>
        <ul className="flex flex-wrap gap-2">
          {NAV_LINKS.map((link) => {
            const current = pathname === link.href;
            return (
              <li key={link.href}>
                <Link
                  href={link.href}
                  aria-current={current ? "page" : undefined}
                  className={`inline-flex items-center rounded-full border-2 border-ink px-3 py-1.5 text-sm font-bold leading-none ${
                    current ? "bg-ink text-paper" : "bg-surface text-ink motion-safe:hover:-translate-y-0.5"
                  } transition-transform`}
                >
                  {link.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </header>
  );
}
