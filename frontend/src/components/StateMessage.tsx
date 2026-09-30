import { useT } from '../lib/i18n';

interface StateMessageProps {
  title: string;
  description?: string;
  tone?: 'default' | 'error';
}

export function StateMessage({
  title,
  description,
  tone = 'default',
}: StateMessageProps) {
  return (
    <div
      className={[
        'm-fade rounded-xl border p-6 text-center',
        tone === 'error'
          ? 'border-red-400/30 bg-red-50'
          : 'border-dashed border-white/[0.12] bg-white/[0.02]',
      ].join(' ')}
    >
      <p
        className={[
          'text-sm font-medium',
          tone === 'error' ? 'text-red-300' : 'text-gray-800',
        ].join(' ')}
      >
        {title}
      </p>
      {description && (
        <p className="mt-1 text-xs text-gray-500">{description}</p>
      )}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  const t = useT();
  return (
    // Fades in after a beat (`m-spinner-in`): most loads here finish sooner
    // than that, and a spinner that flashes for a frame reads as a flicker.
    <div className="m-spinner-in flex items-center justify-center gap-2 py-8 text-sm text-gray-500">
      <svg
        className="h-4 w-4 animate-spin text-brand-400 motion-reduce:animate-none"
        viewBox="0 0 24 24"
        fill="none"
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
        />
      </svg>
      {label ?? t('common.spinner.loading')}
    </div>
  );
}
