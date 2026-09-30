// A dish's allergens as small labels, in the canonical order.
//
// Words, not icons or colours: the fourteen are told apart by their names,
// which is also what the customer asks about. The chips are the same amber
// tint for all of them -- a warning, and the colour adds nothing the word
// does not already say.
//
// `compact` is for under a tile of the team's menu, two to a row on a phone:
// the same words, tighter.

import { useT } from '../../lib/i18n';
import { allergenLabel, sortAllergens } from '../../lib/menu/allergens';

export function AllergenChips({ allergens, compact = false }: { allergens: readonly string[]; compact?: boolean }) {
  const t = useT();
  const list = sortAllergens(allergens);
  if (list.length === 0) {
    return <p className={['text-gray-500', compact ? 'text-[11px] leading-snug' : 'text-xs'].join(' ')}>{t('menu.dish.noAllergens')}</p>;
  }
  return (
    <ul aria-label={t('menu.allergens.label')} className={['flex flex-wrap', compact ? 'gap-1' : 'gap-1.5'].join(' ')}>
      {list.map((code) => (
        <li
          key={code}
          className={[
            'rounded-full bg-amber-50 font-medium text-amber-800 ring-1 ring-inset ring-amber-200/60',
            compact ? 'px-1.5 py-px text-[11px] leading-snug' : 'px-2 py-0.5 text-xs',
          ].join(' ')}
        >
          {allergenLabel(code)}
        </li>
      ))}
    </ul>
  );
}
