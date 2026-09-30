/**
 * One slice of the dictionary: the same set of keys, written twice.
 *
 * `Record<string, string>` on both sides on purpose -- TypeScript cannot force
 * the two objects to have identical keys without a lot of ceremony, so the
 * safety net is the dev-time warning in core.ts when a lookup misses.
 *
 * Keys are namespaced by screen (`dashboard.publish.cta`) so two modules can
 * never collide when they are merged.
 */
export interface MessageModule {
  en: Record<string, string>;
  es: Record<string, string>;
}
