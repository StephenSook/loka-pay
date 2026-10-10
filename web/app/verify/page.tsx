import type { Metadata } from "next";
import { SandboxChip } from "@/components/chips";
import { ReceiptVerifier } from "@/components/receipt-verifier";
import { pinnedDeployment } from "@/lib/deployment";
import { TEST_VECTOR } from "@/lib/test-vector";

// Static at build time: the pinned deployment (config/pins.json, if present) and the
// published test receipt are read here and passed to the browser, where every check runs.
// Receipt links carry the receipt in the fragment (#r=...), which browsers never send.

export const metadata: Metadata = {
  title: "Verify a receipt | LOKA Pay",
  description: "Check a LOKA Pay receipt's signatures in your own browser. No login, nothing sent, nothing stored.",
};

export default function VerifyPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10 sm:px-6 sm:py-16">
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <h1 className="text-5xl sm:text-6xl">Verify a receipt</h1>
          <SandboxChip />
        </div>
        <p className="text-xl leading-relaxed">
          Paste a LOKA Pay receipt or open a receipt link. Your browser checks the payer&apos;s signature, the
          merchant&apos;s acknowledgement and the settlement server&apos;s confirmation on this page.
        </p>
        <p className="text-muted">
          No login. The receipt is not sent to any server, and nothing is stored. Sandbox only: test tokens on
          Solana devnet with no value.
        </p>
      </header>

      <ReceiptVerifier pinned={pinnedDeployment} testVector={TEST_VECTOR} />
    </main>
  );
}
