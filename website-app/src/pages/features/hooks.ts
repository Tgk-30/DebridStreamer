import { useCallback, useEffect, useRef, useState } from 'react';

const SCRAMBLE_CHARS = '!<>-_\\/[]{}=+*^?#%&@01';

/**
 * Scramble-type effect: returns [text, scrambleTo].
 * The target settles left→right over `duration` ms. Reduced-motion → instant.
 */
export function useScramble(initial: string, reduced: boolean) {
  const [text, setText] = useState(initial);
  const timer = useRef<number | null>(null);

  const scrambleTo = useCallback(
    (target: string, duration = 400) => {
      if (timer.current) window.clearInterval(timer.current);
      if (reduced) {
        setText(target);
        return;
      }
      const start = performance.now();
      timer.current = window.setInterval(() => {
        const p = Math.min(1, (performance.now() - start) / duration);
        const settled = Math.floor(p * target.length);
        let out = target.slice(0, settled);
        for (let i = settled; i < target.length; i++) {
          out += target[i] === ' ' ? ' ' : SCRAMBLE_CHARS[(Math.random() * SCRAMBLE_CHARS.length) | 0];
        }
        setText(out);
        if (p >= 1 && timer.current) {
          window.clearInterval(timer.current);
          timer.current = null;
        }
      }, 24);
    },
    [reduced],
  );

  useEffect(
    () => () => {
      if (timer.current) window.clearInterval(timer.current);
    },
    [],
  );

  return [text, scrambleTo] as const;
}

/**
 * Typewriter effect: retypes `text` at `charsPerSec` whenever it changes.
 * Returns the currently typed string. Reduced-motion → full text instantly.
 */
export function useTypewriter(text: string, reduced: boolean, charsPerSec = 30): string {
  const [typed, setTyped] = useState(text);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (timer.current) window.clearInterval(timer.current);
    if (reduced) {
      setTyped(text);
      return;
    }
    setTyped('');
    let i = 0;
    const stepMs = 1000 / charsPerSec;
    timer.current = window.setInterval(() => {
      i += 1;
      setTyped(text.slice(0, i));
      if (i >= text.length && timer.current) {
        window.clearInterval(timer.current);
        timer.current = null;
      }
    }, stepMs);
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [text, reduced, charsPerSec]);

  return typed;
}
