import { Waveform } from "./waveform";

/** A realtime session runs both directions at once over one connection. */
export function DuplexDiagram({ className }: { className?: string }) {
  return (
    <div className={className}>
      <div className="rounded-xl border border-fd-border bg-fd-card p-4 sm:p-6">
        <Lane
          label="openTTSSession"
          from="Text pushed a token at a time"
          to="Audio frames"
          detail="session.push(token)"
        />
        <div className="my-4 h-px bg-fd-border" />
        <Lane
          label="openSTTSession"
          from="Audio frames pushed live"
          to="Transcript events"
          detail="session.push(frame)"
          reverse
        />
      </div>
    </div>
  );
}

function Lane({
  label,
  from,
  to,
  detail,
  reverse = false,
}: {
  label: string;
  from: string;
  to: string;
  detail: string;
  reverse?: boolean;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
      <div className={reverse ? "sm:order-1" : ""}>
        <p className="text-sm font-medium">{from}</p>
        <p className="mt-1 font-mono text-xs text-fd-muted-foreground">{detail}</p>
      </div>

      <div className="flex items-center gap-2 text-fd-muted-foreground sm:order-2 sm:flex-col sm:gap-1">
        <span className="font-mono text-[11px] text-brand">{label}</span>
        <svg viewBox="0 0 64 8" className="h-2 w-16 text-fd-border" aria-hidden>
          <path d="M0 4 H56 M50 1 L56 4 L50 7" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </div>

      <div className={`sm:text-right ${reverse ? "sm:order-0 sm:text-left" : "sm:order-3"}`}>
        <p className="text-sm font-medium">{to}</p>
        <Waveform className={`mt-2 h-4 w-24 text-ember-500/60 ${reverse ? "" : "sm:ml-auto"}`} bars={14} />
      </div>
    </div>
  );
}
