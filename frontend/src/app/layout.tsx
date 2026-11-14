import type { Metadata } from "next";
import { Nunito, Shantell_Sans } from "next/font/google";
import ConsentBanner from "@/components/ConsentBanner";
import Footer from "@/components/Footer";
import Header from "@/components/Header";
import { siteUrl } from "@/lib/site";
import "./globals.css";

const nunito = Nunito({
  variable: "--font-nunito",
  subsets: ["latin"],
});

const shantellSans = Shantell_Sans({
  variable: "--font-shantell-sans",
  subsets: ["latin"],
});

const googleSiteVerification = process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION;

export const metadata: Metadata = {
  title: "HyperStim?",
  metadataBase: new URL(siteUrl),
  // Search Console ownership check (plan 011); no tag when unset.
  verification: googleSiteVerification ? { google: googleSiteVerification } : undefined,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${nunito.variable} ${shantellSans.variable} antialiased`}>
      <body className="flex min-h-svh flex-col bg-white font-sans text-ink">
        <ConsentBanner />
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-navy focus:px-4 focus:py-3 focus:text-white"
        >
          Skip to main content
        </a>
        <Header />
        <main id="main" tabIndex={-1} className="flex-1 focus:outline-none">
          {children}
        </main>
        <Footer />
      </body>
    </html>
  );
}
