import CopyButton from './CopyButton';

interface CodeBlockProps {
  code: string;
  /** Shown above the code (e.g. "bash", "json", "Response 200"). */
  label?: string;
  className?: string;
}

/** Code sample with a copy button. Rendered on the server; only the button is a client component. */
export default function CodeBlock({ code, label, className = '' }: CodeBlockProps) {
  return (
    <div data-code-block className={`my-4 overflow-hidden rounded-xl border border-gray-800 bg-gray-950 ${className}`}>
      <div className="flex items-center justify-between border-b border-gray-800 px-4 py-2">
        <span className="text-xs font-medium uppercase tracking-wide text-gray-400">{label || 'code'}</span>
        <CopyButton label={label || 'code'} />
      </div>
      <pre className="overflow-x-auto p-4 text-[13px] leading-relaxed text-gray-100"><code>{code}</code></pre>
    </div>
  );
}
