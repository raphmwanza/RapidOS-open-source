'use client';

import { useRef, useState } from 'react';
import { copyText } from '@/lib/clipboard';

/** Copies the text of the <code> element in the same code block. */
export default function CopyButton({ label }: { label: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  async function onCopy() {
    const code = ref.current?.closest('[data-code-block]')?.querySelector('code')?.textContent ?? '';
    const ok = code !== '' && (await copyText(code));
    setState(ok ? 'copied' : 'failed');
    window.setTimeout(() => setState('idle'), 1800);
  }

  return (
    <button
      ref={ref}
      type="button"
      onClick={onCopy}
      className="rounded-md px-2 py-1 text-xs font-semibold text-gray-300 hover:bg-gray-800 hover:text-white"
      aria-label={`Copy ${label} to clipboard`}
    >
      <span aria-live="polite">{state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy'}</span>
    </button>
  );
}
