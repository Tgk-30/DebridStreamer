import { useEffect, useRef, useState } from 'react';
import { useInView, useReducedMotion } from 'framer-motion';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface TerminalLine {
  text: string;
  /** output lines fade in after their command finishes */
  output?: boolean;
}

interface TerminalBlockProps {
  lines: TerminalLine[];
  className?: string;
  title?: string;
}

const CHAR_MS = 1000 / 34; // 34 chars/s
const LINE_PAUSE = 250;

/**
 * TerminalBlock - dark --bg-0 panel, window dots (brand/accent/warm), mono text.
 * Commands type at 34 chars/s when 60% in view; copy button flashes "Copied ✓".
 */
export default function TerminalBlock({ lines, className, title = 'terminal' }: TerminalBlockProps) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.6 });

  const [typedCount, setTypedCount] = useState(0); // chars typed across all command lines
  const [done, setDone] = useState(false);
  const [copied, setCopied] = useState(false);

  const fullText = lines.map((l) => l.text).join('\n');
  const totalCmdChars = lines.filter((l) => !l.output).reduce((n, l) => n + l.text.length, 0);

  useEffect(() => {
    if (!inView || reduced) return;
    let cancelled = false;
    let count = 0;

    // cumulative char budget per command line (for the 250ms line pause)
    const cmdLines = lines.filter((l) => !l.output);
    const cumChars: number[] = [];
    cmdLines.reduce((acc, l) => {
      const next = acc + l.text.length;
      cumChars.push(next);
      return next;
    }, 0);

    const tick = () => {
      if (cancelled) return;
      count += 1;
      setTypedCount(count);
      if (count >= totalCmdChars) {
        setDone(true);
        return;
      }
      // pause briefly when a line completes
      const justFinishedLine = cumChars.includes(count);
      window.setTimeout(tick, justFinishedLine ? LINE_PAUSE : CHAR_MS);
    };
    const start = window.setTimeout(tick, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(start);
    };
  }, [inView, reduced, totalCmdChars, lines]);

  // reduced motion → everything rendered instantly, no typing
  const effectiveTyped = reduced ? totalCmdChars : typedCount;
  const effectiveDone = reduced || done;

  // reconstruct visible lines from the global typed budget
  const rendered = lines.map((line, i) => {
    if (line.output) return { ...line, visible: effectiveDone, text: line.text };
    const start = lines.slice(0, i).reduce((n, l) => n + (l.output ? 0 : l.text.length), 0);
    const take = Math.max(0, Math.min(line.text.length, effectiveTyped - start));
    return { ...line, visible: take > 0, text: line.text.slice(0, take) };
  });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(fullText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div
      ref={ref}
      className={cn(
        'relative overflow-hidden rounded-card border border-line bg-bg-0 shadow-card',
        className,
      )}
    >
      {/* window chrome */}
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <span className="h-2.5 w-2.5 rounded-full bg-[rgba(var(--brand-rgb),0.8)]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[rgba(var(--accent-rgb),0.8)]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[rgba(var(--warm-rgb),0.8)]" />
        <span className="ml-2 font-mono text-[0.75rem] tracking-[0.04em] text-ink-3">{title}</span>
        <button
          type="button"
          onClick={copy}
          aria-label="Copy commands"
          className={cn(
            'ml-auto inline-flex items-center gap-1.5 rounded-md border border-line px-2 py-1 font-mono text-[0.75rem] text-ink-3',
            'transition-colors duration-150 hover:border-line-strong hover:text-brand',
            copied && 'border-[rgba(var(--brand-rgb),0.5)] text-brand',
          )}
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? 'Copied ✓' : 'Copy'}
        </button>
      </div>

      <div className="overflow-x-auto p-5 font-mono text-[0.9rem] leading-[1.7]">
        {rendered.map((line, i) => (
          <div
            key={i}
            className={cn('whitespace-pre transition-opacity duration-500', line.visible ? 'opacity-100' : 'opacity-0')}
          >
            {line.output ? (
              <span className="text-ink-3">{line.text || ' '}</span>
            ) : (
              <>
                <span className="mr-2 select-none text-brand">$</span>
                <span className="text-ink-1">{line.text}</span>
              </>
            )}
          </div>
        ))}
        <span
          aria-hidden="true"
          className={cn('mt-1 inline-block h-[1.05em] w-[0.55em] translate-y-[2px] bg-brand', !reduced && 'animate-caret-blink')}
        />
      </div>
    </div>
  );
}
