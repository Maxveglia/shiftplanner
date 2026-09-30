import type { ReactNode } from 'react';

type Tone = 'gray' | 'green' | 'blue' | 'amber' | 'red' | 'purple';

// Dark tints with light text and a faint rim of the same hue, as the stage's
// chips are. Blue and purple are not in the app's palette (tailwind.config.js
// redefines gray, brand, red, amber and green only), so they are written out
// here as dark tints: Tailwind's own 100/800 are a pale chip with dark text.
// Every pair is 7:1 or better on a card.
const toneClasses: Record<Tone, string> = {
  gray: 'bg-white/[0.06] text-gray-700 ring-white/10',
  green: 'bg-green-100 text-green-800 ring-green-200/60',
  blue: 'bg-sky-400/[0.12] text-sky-300 ring-sky-400/25',
  amber: 'bg-amber-100 text-amber-800 ring-amber-200/60',
  red: 'bg-red-100 text-red-800 ring-red-200/60',
  purple: 'bg-violet-400/[0.12] text-violet-300 ring-violet-400/25',
};

export function Badge({
  tone = 'gray',
  children,
}: {
  tone?: Tone;
  children: ReactNode;
}) {
  return (
    <span
      className={[
        'inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset',
        toneClasses[tone],
      ].join(' ')}
    >
      {children}
    </span>
  );
}
