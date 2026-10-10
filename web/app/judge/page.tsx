import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { SandboxChip } from "@/components/chips";
import { CiStatusList } from "@/components/ci-status";
import { CARD, OutLink, PAGE } from "@/components/judge-ui";
import { ProgramFactsPanel } from "@/components/program-facts";
import { readProgramFacts } from "@/lib/chain";
import { TESTFLIGHT_STATUS, TESTFLIGHT_STATUS_AS_OF } from "@/lib/facts";
import { readMainChecks } from "@/lib/github";
import { shownTogether } from "@/lib/read-state";
import { REPO_URL } from "@/lib/site";

// The judge door (PLAN.md 3.2): a numbered three-minute route through everything a judge
// can check without logging in. Rendered per request (connection()); the devnet reads
// behind step 2 are cached for 30 seconds in lib/chain.ts, and the workflow results behind
// step 7 for 5 minutes in lib/github.ts. Every read is made by this server: the page loads
// nothing from another site.

export const metadata: Metadata = {
  title: "Judge door | LOKA Pay",
  description: "A three-minute route through LOKA Pay: a receipt you check in your browser, the program on devnet, the live feed, the proof and the threat model. No login.",
};

function Step({
  n,
  title,
  minutes,
  children,
}: {
  n: number;
  title: string;
  minutes: string;
  children: React.ReactNode;
}) {
  return (
    <li className={`${CARD} flex min-w-0 flex-col gap-4`} data-testid={`step-${n}`}>
      <div className="flex min-w-0 items-start gap-4">
        <span
          aria-hidden="true"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-3 border-ink bg-pending font-display text-xl font-extrabold text-on-state"
        >
          {n}
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-2xl sm:text-3xl">
            <span className="sr-only">Step {n}: </span>
            {title}
          </h2>
          <p className="text-sm font-bold text-muted">{minutes}</p>
        </div>
      </div>
      {children}
    </li>
  );
}

function GoLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex w-fit items-center gap-2 rounded-full border-3 border-ink bg-ink px-5 py-2.5 font-bold text-paper shadow-hard transition-transform motion-safe:hover:-translate-y-0.5"
    >
      {children}
      <span aria-hidden="true">→</span>
    </Link>
  );
}

export default async function JudgePage() {
  await connection();
  // Both reads' ages are decided at one render time, after the slower one has arrived.
  const [facts, checks] = shownTogether(await Promise.all([readProgramFacts(), readMainChecks()]));
  return (
    <main className={PAGE}>
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <h1 className="text-5xl sm:text-6xl">Judge door</h1>
          <SandboxChip />
        </div>
        <p className="text-xl leading-relaxed">
          Seven stops, about three minutes, no login anywhere. Chain facts on these pages are read from Solana devnet,
          each with the slot and time it was read, and marked when the value is a cached read.
        </p>
        <p className="text-muted">Sandbox only: test tokens on Solana devnet with no value. No real money moves.</p>
      </header>

      <ol className="flex flex-col gap-6" aria-label="Itinerary">
        <Step n={1} title="Check a receipt in your browser" minutes="About 30 seconds">
          <p className="leading-relaxed">
            Open the verifier and press <strong>Try the published test receipt</strong>. Your browser checks the
            payer&apos;s P-256 signature, the merchant&apos;s acknowledgement and the settlement server&apos;s
            confirmation on the page, with nothing sent anywhere. That receipt is a labelled test vector made from
            public test keys, not a real payment.
          </p>
          <GoLink href="/verify">Open /verify</GoLink>
        </Step>

        <Step n={2} title="The program on devnet" minutes="About 40 seconds">
          <p className="leading-relaxed">
            The <code className="font-mono text-sm">loka_vault</code> program verifies the phone&apos;s signature on
            chain and holds the sandbox tokens. These facts come from a devnet read; the line under them says when it
            was read and how old it was when this page loaded.
          </p>
          <ProgramFactsPanel read={facts} />
        </Step>

        <Step n={3} title="Watch the chain" minutes="About 30 seconds">
          <p className="leading-relaxed">
            Every transaction that touches the program, newest first, then each new one as it lands. Your browser reads
            devnet directly, so the feed keeps working even if our server is down.
          </p>
          <GoLink href="/live">Open /live</GoLink>
          <p className="text-sm">
            Or have your own phone ring when a payment settles:{" "}
            <Link prefetch={false} href="/call" className="font-bold underline">
              /call
            </Link>
            .
          </p>
        </Step>

        <Step n={4} title="Proof" minutes="About 30 seconds">
          <p className="leading-relaxed">
            Each claim marked Live links to its evidence and says when that evidence was read; the verifier is Available
            to run yourself, and the rest say Not checked or Building. Then the vault&apos;s tokens against everything it owes, read at one slot, and what this team
            committed since hacking started.
          </p>
          <GoLink href="/proof">Open /proof</GoLink>
        </Step>

        <Step n={5} title="Trust" minutes="About 20 seconds">
          <p className="leading-relaxed">
            What the program checks before it moves money, what the protocol does not promise, and who holds which key.
          </p>
          <GoLink href="/trust">Open /trust</GoLink>
        </Step>

        <Step n={6} title="The iPhone app" minutes="About 10 seconds">
          <p className="leading-relaxed" data-testid="testflight-status">
            {TESTFLIGHT_STATUS}.
          </p>
          <p className="text-sm text-muted">
            Status as of <time dateTime={TESTFLIGHT_STATUS_AS_OF}>{TESTFLIGHT_STATUS_AS_OF}</time>.
          </p>
        </Step>

        <Step n={7} title="The code and its checks" minutes="About 20 seconds">
          <p className="leading-relaxed">
            The repository is public. Each line below is the result GitHub reports for that workflow&apos;s job on
            main&apos;s latest commit, read by this site&apos;s server, so your browser loads nothing from GitHub. Select
            one to open it on GitHub.
          </p>
          <OutLink href={REPO_URL} testId="repo-link">
            github.com/StephenSook/loka-pay
          </OutLink>
          <CiStatusList read={checks} />
        </Step>
      </ol>
    </main>
  );
}
