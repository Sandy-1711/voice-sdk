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

export const metadata: Metadata = {
  title: {
    default: "voice-sdk — one TypeScript interface for voice providers",
    template: "%s · voice-sdk",
  },
  description:
    "Text-to-speech and speech-to-text, batch and realtime, with one set of types across Cartesia, Deepgram and ElevenLabs.",
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
