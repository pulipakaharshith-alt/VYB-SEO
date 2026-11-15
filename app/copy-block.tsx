'use client';

import { useState } from 'react';

/** A code block with a copy button. */
export function CopyBlock({ code, label }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative rounded-xl border border-line bg-panel">
      {label && <div className="border-b border-line px-4 py-2 text-xs text-muted">{label}</div>}
      <pre className="whitespace-pre-wrap break-words px-4 py-3 pb-10 font-mono text-[13px] leading-relaxed">{code}</pre>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            setCopied(false);
          }
        }}
        className="absolute right-2 bottom-2 rounded-md border border-line bg-bg px-2.5 py-1 text-xs text-muted hover:text-text"
        aria-label="Copy to clipboard"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}
