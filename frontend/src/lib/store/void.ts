// Voiding a sale: the only thing that can happen to one once it is saved.
//
// A sale is never deleted and never edited (api/store.ts says why). One made
// by mistake -- charged twice, the wrong amount -- is voided: it stays in the
// list where it happened, says when, by whom and why, and counts for nothing
// in any figure (lib/store/group.ts, and the server's statistics).

import type { StoreSale, StoreSaleSummary } from '../../api/store';
import { translate } from '../i18n/core';
import { formatInstant } from './format';

/**
 * The reason as the server keeps it: NULs dropped, the ends trimmed, blank as
 * none. The field stops at MAX_VOID_REASON (api/store.ts) as it is typed.
 */
export function cleanVoidReason(text: string | null | undefined): string | null {
  const cleaned = (text ?? '').replace(/\0/g, '').trim();
  return cleaned === '' ? null : cleaned;
}

/**
 * What a voided sale says about itself: "Anulada el 27 sept 2026 a las 13:05
 * por Marta." -- without "por" when the server names nobody (an account
 * deleted since keeps the void, not the name). Null for a sale that stands.
 */
export function voidedSentence(sale: Pick<StoreSale, 'voided_at' | 'voided_by_name'>): string | null {
  const when = formatInstant(sale.voided_at);
  if (!when) return null;
  const name = sale.voided_by_name?.trim();
  return name
    ? translate('store.sale.voidedAtBy', { day: when.day, time: when.time, name })
    : translate('store.sale.voidedAt', { day: when.day, time: when.time });
}

/**
 * The clock a till sale was charged at, "13:05", for its row and its page.
 * Only a till sale: one typed by hand was entered whenever the manager sat
 * down to it, and that clock says nothing about the sale.
 */
export function chargedAt(sale: Pick<StoreSaleSummary, 'source' | 'created_at'>): string | null {
  if (sale.source !== 'till') return null;
  return formatInstant(sale.created_at)?.time ?? null;
}

/**
 * Who saved the sale, for its page: "Cobrada por Marta" for one charged at
 * the till, "Apuntada por Max" for one typed in by hand -- by name also once
 * that login is deleted (a tablet removed, a person taken off the team): the
 * server keeps it with the sale. With no name (a sale whose login was gone
 * before the server kept names), that it was an account that no longer
 * exists. Null when the server did not say (a release behind): better
 * nothing than "an account that no longer exists" over one that does.
 */
export function recordedBySentence(sale: Pick<StoreSale, 'source' | 'created_by_name'>): string | null {
  if (sale.created_by_name === undefined) return null;
  const name = sale.created_by_name?.trim();
  if (sale.source === 'till') {
    return name ? translate('store.sale.chargedBy', { name }) : translate('store.sale.chargedByGone');
  }
  return name ? translate('store.sale.enteredBy', { name }) : translate('store.sale.enteredByGone');
}
