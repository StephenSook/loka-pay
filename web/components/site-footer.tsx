import Link from "next/link";
import { REPO_URL } from "@/lib/site";

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t-3 border-ink">
      <nav
        aria-label="Footer"
        className="mx-auto flex w-full max-w-3xl flex-wrap gap-x-6 gap-y-2 px-4 py-6 text-sm font-bold sm:px-6"
      >
        <Link href="/" className="underline">
          Home
        </Link>
        <Link href="/judge" className="underline">
          Judge door
        </Link>
        <Link href="/live" className="underline">
          Live
        </Link>
        <Link href="/verify" className="underline">
          Verify a receipt
        </Link>
        <Link href="/proof" className="underline">
          Proof
        </Link>
        <Link href="/trust" className="underline">
          Trust
        </Link>
        <Link href="/privacy" className="underline">
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
