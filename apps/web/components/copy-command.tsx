"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

export function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(command).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      aria-label={`Copy: ${command}`}
      className="group flex items-center gap-3 rounded-lg border border-fd-border bg-fd-card px-4 py-2.5 font-mono text-sm text-fd-foreground transition-colors hover:bg-fd-accent"
    >
      <span className="text-fd-muted-foreground select-none">$</span>
      <span className="truncate">{command}</span>
      {copied ? (
        <Check className="size-4 shrink-0 text-fd-primary" />
      ) : (
        <Copy className="size-4 shrink-0 text-fd-muted-foreground group-hover:text-fd-foreground" />
      )}
    </button>
  );
}
