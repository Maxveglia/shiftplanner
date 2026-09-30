// How a sale was paid, as a word with its sign: "Efectivo" beside a banknote,
// "Tarjeta" beside a card. The word is always written -- the sign helps an
// eye running down a column of sales, and is never the only thing that says
// it (it is hidden from screen readers, which read the word).

import type { PaymentMethod } from '../../api/store';
import { useT } from '../../lib/i18n';

export function PaymentMethodIcon({ method, className = 'h-3.5 w-3.5' }: { method: PaymentMethod; className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`shrink-0 ${className}`}
    >
      {method === 'cash' ? (
        <>
          <rect x="2.5" y="5.5" width="15" height="9" rx="1.5" />
          <circle cx="10" cy="10" r="2" />
          <path d="M5.5 8v4M14.5 8v4" />
        </>
      ) : (
        <>
          <rect x="2.5" y="4.5" width="15" height="11" rx="1.5" />
          <path d="M2.5 8.5h15M5.5 12.5h3" />
        </>
      )}
    </svg>
  );
}

export function PaymentMethodLabel({ method, className = '' }: { method: PaymentMethod; className?: string }) {
  const t = useT();
  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <PaymentMethodIcon method={method} />
      {t(method === 'cash' ? 'store.pay.cash' : 'store.pay.card')}
    </span>
  );
}
