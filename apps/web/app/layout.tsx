import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Inter, Instrument_Sans, JetBrains_Mono } from "next/font/google";
import { RootProvider } from "fumadocs-ui/provider/next";
import { ScrollToTop } from "@/components/scroll-to-top";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const instrument = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-instrument",
  display: "swap",
});
const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

const SITE_URL = "https://voice-ai-sdk.vercel.app";

const TITLE = "voice-sdk: one TypeScript SDK for text-to-speech and speech-to-text";
const DESCRIPTION =
  "Text-to-speech and speech-to-text, batch and realtime, with one set of types across Cartesia, Deepgram and ElevenLabs.";

export const metadata: Metadata = {
  // Without this, relative Open Graph and canonical URLs resolve against
  // localhost in the build output.
  metadataBase: new URL(SITE_URL),
  title: { default: TITLE, template: "%s | voice-sdk" },
  description: DESCRIPTION,
  openGraph: {
    type: "website",
    siteName: "voice-sdk",
    url: SITE_URL,
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${instrument.variable} ${jetbrains.variable}`}
    >
      <body className="flex min-h-screen flex-col">
        <ScrollToTop />
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
