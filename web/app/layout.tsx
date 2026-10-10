import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Figtree } from "next/font/google";
import { SiteFooter } from "@/components/site-footer";
import { SENTENCE } from "@/lib/site";
import "./globals.css";

// next/font downloads these at build time and serves them from this site,
// so a page load never requests a font from another origin.
const display = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["800"],
  variable: "--font-bricolage",
  display: "swap",
});

const body = Figtree({
  subsets: ["latin"],
  weight: ["500", "700"],
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
