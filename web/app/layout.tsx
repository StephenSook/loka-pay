import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { SiteFooter } from "@/components/site-footer";
import { SENTENCE } from "@/lib/site";
import "./globals.css";

// The font files are committed (app/fonts, SIL Open Font License, from Fontsource 5.3.0),
// so neither a build nor a page load ever contacts another origin. next/font/google
// downloaded them at build time, and a failed download broke a main CI build.
const display = localFont({
  src: [{ path: "./fonts/bricolage-grotesque-latin-800-normal.woff2", weight: "800", style: "normal" }],
  variable: "--font-bricolage",
  display: "swap",
});

const body = localFont({
  src: [
    { path: "./fonts/figtree-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/figtree-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-figtree",
  display: "swap",
});

export const metadata: Metadata = {
  title: "LOKA Pay",
  description: SENTENCE,
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbf8f3" },
    { media: "(prefers-color-scheme: dark)", color: "#14163a" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} antialiased`}>
      <body className="flex min-h-dvh flex-col">
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
