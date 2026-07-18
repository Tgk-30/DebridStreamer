/* Brand page - non-component helpers (kept component-free for fast refresh). */

export const EASE_EXPO = [0.16, 1, 0.3, 1] as [number, number, number, number];

/* ── Clipboard ─────────────────────────────────────────────────────────── */

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      return true;
    } catch {
      return false;
    }
  }
}

/* ── Tiny page-local toast bus (App-level toaster is out of scope) ─────── */

const toastListeners = new Set<(msg: string) => void>();

export function toast(msg: string): void {
  toastListeners.forEach((l) => l(msg));
}

export function subscribeToast(fn: (msg: string) => void): () => void {
  toastListeners.add(fn);
  return () => {
    toastListeners.delete(fn);
  };
}

/** Copy + toast in one call (used by every "copy-on-click" surface). */
export async function copyWithToast(text: string, label = 'Copied'): Promise<void> {
  const ok = await copyText(text);
  toast(ok ? `${label} ✓` : 'Copy failed');
}
