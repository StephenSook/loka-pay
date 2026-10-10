import Link from "next/link";
import { SandboxChip } from "@/components/chips";
import { ArrowUpRightIcon } from "@/components/icons";
import { REPO_URL, SENTENCE } from "@/lib/site";

const PAGES = [
  { href: "/live", title: "Live", text: "The program's transactions, read by your browser straight from devnet." },
  { href: "/verify", title: "Verify", text: "Check a payment receipt's signatures in your browser." },
  { href: "/proof", title: "Proof", text: "Each claim with its evidence, and the vault's reserves read at one slot." },
  { href: "/trust", title: "Trust", text: "What the program checks, what it does not promise, who holds which key." },
] as const;

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10 sm:px-6 sm:py-16">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <h1 className="text-5xl sm:text-6xl">LOKA Pay</h1>
        <SandboxChip />
      </header>

      <p className="text-xl leading-relaxed sm:text-2xl">{SENTENCE}</p>

      <p className="text-muted">Sandbox only: test tokens on Solana devnet with no value. No real money moves.</p>

      <Link
        href="/judge"
        className="inline-flex w-fit items-center gap-2 rounded-full border-3 border-ink bg-pending px-6 py-3 font-bold text-on-state shadow-hard transition-transform motion-safe:hover:-translate-y-0.5"
      >
        Judge door: three minutes, no login
        <span aria-hidden="true">→</span>
      </Link>

      <section aria-label="Status and links" className="grid gap-6 sm:grid-cols-2">
        <div className="min-w-0 rounded-card border-3 border-ink bg-surface p-5 shadow-hard">
          <h2 className="text-2xl">Status</h2>
          <p className="mt-2 leading-relaxed">
            Built this weekend at Hacklanta II. The payment loop is being built now.
          </p>
        </div>

        <div className="flex min-w-0 flex-col items-start justify-center gap-4">
          <a
            href={REPO_URL}
            className="inline-flex items-center gap-2 rounded-full border-3 border-ink bg-ink px-6 py-3 font-bold text-paper shadow-hard transition-transform motion-safe:hover:-translate-y-0.5"
          >
            Read the code on GitHub
            <ArrowUpRightIcon />
          </a>
          <Link href="/privacy" className="font-bold underline">
            Privacy: no sign-up, no login, no profile
          </Link>
        </div>
      </section>

      <section aria-labelledby="check-it" className="flex flex-col gap-4">
        <h2 id="check-it" className="text-3xl">
          Check it yourself
        </h2>
        <ul className="grid gap-4 sm:grid-cols-2">
          {PAGES.map((p) => (
            <li key={p.href} className="min-w-0">
              <Link
                href={p.href}
                className="flex h-full min-w-0 flex-col gap-1 rounded-card border-3 border-ink bg-surface p-5 shadow-hard transition-transform motion-safe:hover:-translate-y-0.5"
              >
                <span className="font-display text-2xl font-extrabold tracking-display">{p.title}</span>
                <span className="text-muted">{p.text}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
