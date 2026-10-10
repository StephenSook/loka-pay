import Link from "next/link";
import { REPO_URL } from "@/lib/site";

// prefetch={false} on every link (header too): a background prefetch is a request the
// visitor did not ask for, and /verify promises that checking a receipt sends nothing.
export function SiteFooter() {
  return (
    <footer className="mt-auto border-t-3 border-ink">
      <nav
        aria-label="Footer"
        className="mx-auto flex w-full max-w-3xl flex-wrap gap-x-6 gap-y-2 px-4 py-6 text-sm font-bold sm:px-6"
      >
        <Link prefetch={false} href="/" className="underline">
          Home
        </Link>
        <Link prefetch={false} href="/judge" className="underline">
          Judge door
        </Link>
        <Link prefetch={false} href="/live" className="underline">
          Live
        </Link>
        <Link prefetch={false} href="/verify" className="underline">
          Verify a receipt
        </Link>
        <Link prefetch={false} href="/proof" className="underline">
          Proof
        </Link>
        <Link prefetch={false} href="/trust" className="underline">
          Trust
        </Link>
        <Link prefetch={false} href="/privacy" className="underline">
          Privacy
        </Link>
        <a href={REPO_URL} className="underline">
          Source code
        </a>
        <span className="text-muted">Apache-2.0</span>
      </nav>
    </footer>
  );
}
