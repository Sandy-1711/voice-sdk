const PROVIDERS = ["Cartesia", "Deepgram", "ElevenLabs"];

/** Your code talks to one interface; the interface talks to whichever provider. */
export function SwapDiagram({ className }: { className?: string }) {
  return (
    <div className={className}>
      <div className="flex flex-col items-center gap-0">
        <Node label="Your application" tone="muted" />
        <Connector />

        <div className="w-full max-w-xs rounded-xl border border-ember-500/40 bg-ember-500/5 px-4 py-3 text-center">
          <p className="font-mono text-sm font-medium text-brand">Voice</p>
          <p className="mt-0.5 font-mono text-[11px] text-fd-muted-foreground">
            speak · transcribe · sessions
          </p>
        </div>

        <div className="relative h-10 w-full max-w-md">
          <svg
            viewBox="0 0 300 40"
            preserveAspectRatio="none"
            className="h-full w-full text-fd-border"
            aria-hidden
          >
            <path
              d="M150 0 L150 14 M150 14 L50 14 L50 40 M150 14 L150 40 M150 14 L250 14 L250 40"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            />
          </svg>
        </div>

        <div className="grid w-full grid-cols-3 gap-2 sm:gap-3">
          {PROVIDERS.map((provider) => (
            <div
              key={provider}
              className="rounded-lg border border-fd-border bg-fd-card px-2 py-2.5 text-center"
            >
              <p className="truncate text-xs font-medium sm:text-sm">{provider}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Node({ label, tone }: { label: string; tone: "muted" }) {
  return (
    <div
      className={`rounded-lg border border-fd-border px-4 py-2 text-sm ${
        tone === "muted" ? "text-fd-muted-foreground" : ""
      }`}
    >
      {label}
    </div>
  );
}

function Connector() {
  return <div className="h-6 w-px bg-fd-border" />;
}
