import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

export const GITHUB_URL = "https://github.com/Sandy-1711/voice-sdk";
export const NPM_URL = "https://www.npmjs.com/package/@swungstudent/voice";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <>
          <span className="font-mono font-semibold">voice-sdk</span>
        </>
      ),
    },
    links: [
      { text: "Documentation", url: "/docs", active: "nested-url" },
      { text: "Providers", url: "/docs/providers", active: "nested-url" },
      { type: "icon", text: "GitHub", url: GITHUB_URL, icon: <GitHubIcon /> },
    ],
    githubUrl: GITHUB_URL,
  };
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58v-2.03c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.2.09 1.84 1.24 1.84 1.24 1.07 1.84 2.81 1.31 3.5 1 .11-.78.42-1.31.76-1.61-2.67-.3-5.47-1.34-5.47-5.96 0-1.32.47-2.39 1.24-3.24-.12-.3-.54-1.53.12-3.18 0 0 1.01-.32 3.3 1.24a11.5 11.5 0 0 1 6.01 0c2.29-1.56 3.3-1.24 3.3-1.24.66 1.65.24 2.88.12 3.18.77.85 1.24 1.92 1.24 3.24 0 4.63-2.8 5.65-5.48 5.95.43.37.81 1.1.81 2.22v3.29c0 .32.21.7.83.58A12.01 12.01 0 0 0 24 12.5C24 5.87 18.63.5 12 .5Z" />
    </svg>
  );
}
