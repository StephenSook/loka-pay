import type { Metadata } from "next";
import { CONTACT_EMAIL } from "@/lib/site";

// Also the App Store Connect privacy policy URL for the TestFlight build
// (https://zerobars.us/privacy). Every sentence here must be true today; when the
// settlement server goes live, the "What we store" table lists each stored field.

export const metadata: Metadata = {
  title: "Privacy | LOKA Pay",
  description: "LOKA Pay privacy policy: no sign-up, no login, no profile.",
};

const UPDATED = "2026-10-10";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-2xl">{title}</h2>
      {children}
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10 leading-relaxed sm:px-6 sm:py-16">
      <header className="flex flex-col gap-2">
        <h1 className="text-5xl sm:text-6xl">Privacy</h1>
        <p className="text-muted">
          Updated <time dateTime={UPDATED}>{UPDATED}</time>
        </p>
      </header>

      <div className="rounded-card border-3 border-ink bg-surface p-5 shadow-hard">
        <p className="text-xl font-bold">No sign-up, no login, no profile.</p>
        <p className="mt-2">
          LOKA Pay has no accounts. There is nothing to sign up for or log in to, and we keep no
          profile of you.
        </p>
      </div>

      <p>
        LOKA Pay is a sandbox prototype built at the Hacklanta II hackathon. It uses test tokens on
        Solana devnet that have no monetary value. &quot;We&quot; means the LOKA Pay team.
      </p>

      <Section title="The iPhone app">
        <p>
          The iPhone app keeps its keys on the phone. Messages, photos and voice notes travel
          end-to-end encrypted to the person you send them to, over Bluetooth or a local Wi-Fi
          network, and are stored on the phones involved. The app does not send them to us.
        </p>
        <p>
          The app asks for these permissions, each only for the feature named: Bluetooth (to reach
          nearby phones), camera (to scan codes and take photos for messages), microphone (to record
          voice notes), contacts (to find a name for a phone number you type; contacts stay on the
          phone and are never uploaded), local network (to reach nearby phones on Wi-Fi) and Face ID
          (to approve each payment).
        </p>
      </Section>

      <Section title="This website">
        <p>
          This website sets no cookies and runs no analytics or tracking. Its fonts are served from
          this site&apos;s own address.
        </p>
        <p>
          Two pages make your browser contact another website, and only to show public data: /live
          connects to Solana&apos;s public devnet server (api.devnet.solana.com) to read the
          program&apos;s transactions, and /judge shows workflow status badges loaded from
          github.com. Those sites see your browser&apos;s request, as any website does; this site
          sends them nothing about you. Every other page makes no request to any other website.
        </p>
        <p>
          The /judge, /proof and /trust pages read public data from Solana devnet and GitHub on our
          server, not from your browser, and those reads carry nothing about you.
        </p>
        <p>
          It is hosted on Vercel. We have not turned on Vercel Web Analytics or Speed Insights.
        </p>
      </Section>

      <Section title="The settlement server">
        <p>
          The settlement server is not live yet. When it is, the table below will list exactly what
          it stores, where it lives and why.
        </p>
      </Section>

      <Section title="What we store">
        <table className="w-full table-fixed border-collapse border-3 border-ink bg-surface text-left">
          <thead>
            <tr>
              <th scope="col" className="border-2 border-ink p-3 align-top font-bold">
                Field
              </th>
              <th scope="col" className="border-2 border-ink p-3 align-top font-bold">
                Where it lives
              </th>
              <th scope="col" className="border-2 border-ink p-3 align-top font-bold">
                Why
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="break-words border-2 border-ink p-3 align-top">Nothing yet</td>
              <td className="break-words border-2 border-ink p-3 align-top">Nowhere</td>
              <td className="break-words border-2 border-ink p-3 align-top">
                The settlement server is not live.
              </td>
            </tr>
          </tbody>
        </table>
      </Section>

      <Section title="Contact">
        <p>
          Questions about privacy:{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="break-all font-bold underline">
            {CONTACT_EMAIL}
          </a>
        </p>
      </Section>
    </main>
  );
}
