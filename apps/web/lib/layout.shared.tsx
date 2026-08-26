import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { Waveform } from "@/components/graphics/waveform";

export const GITHUB_URL = "https://github.com/Sandy-1711/voice-sdk";
export const NPM_URL = "https://www.npmjs.com/package/@swungstudent/voice";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="flex items-center gap-2">
          <Waveform className="h-4 w-5 text-ember-500" bars={4} />
          <span className="font-display text-[15px] font-semibold tracking-tight">voice-sdk</span>
        </span>
      ),
    },
    links: [
      { text: "Docs", url: "/docs", active: "nested-url" },
      { text: "Providers", url: "/docs/providers", active: "nested-url" },
      { text: "Examples", url: "/docs/examples", active: "nested-url" },
    ],
    githubUrl: GITHUB_URL,
  };
}
