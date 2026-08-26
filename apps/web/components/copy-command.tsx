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
      aria-label={`Copy ${command}`}
      className="group flex w-full items-center gap-3 rounded-md border border-fd-border bg-fd-card px-4 py-3 text-left font-mono text-[13px] transition-colors hover:border-ember-500/40"
    >
      <span className="text-ember-500 select-none">$</span>
      <span className="flex-1 truncate">{command}</span>
      {copied ? (
        <Check className="size-4 shrink-0 text-ember-500" />
      ) : (
        <Copy className="size-4 shrink-0 text-fd-muted-foreground transition-colors group-hover:text-fd-foreground" />
      )}
    </button>
  );
}
