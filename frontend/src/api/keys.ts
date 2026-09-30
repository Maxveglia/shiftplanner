// Centralised TanStack Query keys.
export const queryKeys = {
  /** Which apps this business has on; anybody signed in to it. */
  workspace: ['workspace'] as const,
  me: ['me'] as const,
  myProfile: ['me', 'profile'] as const,
  myBusiness: ['me', 'business'] as const,
  /** Whether the signed-in employee wants their rota by email. */
  myNotifications: ['me', 'notifications'] as const,
  employees: ['employees'] as const,
  employee: (id: string) => ['employees', id] as const,
  employeeContracts: (id: string) => ['employees', id, 'contracts'] as const,
  employeeAccount: (id: string) => ['employees', id, 'account'] as const,
  /** Who can sign in to the business, and as what (/access); managers only. */
  access: ['access'] as const,
  vacationBalance: (id: string) => ['employees', id, 'vacation-balance'] as const,
  shiftTemplates: ['shift-templates'] as const,
  absenceTypes: ['absence-types'] as const,
  absences: ['absences'] as const,
  laborProfiles: ['labor-profiles'] as const,
  payPolicy: ['org', 'pay-policy'] as const,
  businessProfile: ['profile'] as const,
  /** What the planner has noted about this business; managers only. */
  interviewStatus: ['interview', 'status'] as const,
  /** Whether the business assistant exists on this server; managers only. */
  assistantStatus: ['assistant', 'status'] as const,
  /** What the business assistant remembers about this business. */
  assistantMemories: ['assistant', 'memories'] as const,
  /** Published shifts for a window; the window is part of the key. */
  publishedSchedule: (from: string, to: string) =>
    ['schedule', 'published', from, to] as const,
  /** The manager's unpublished draft for a window; managers only. */
  draftSchedule: (from: string, to: string) =>
    ['schedule', 'draft', from, to] as const,
  /**
   * The working year for a window (art. 34 ET); managers only.
   *
   * The zone is part of the key for the same reason it is in `balances`: the
   * server cuts a year of shifts into DAYS with it, and the days are what get
   * added into weeks and months. Two zones are two different readings of the
   * same window.
   */
  workday: (from: string, to: string, tz: string | null = null) =>
    ['workday', from, to, tz] as const,
  /**
   * Each employee's month, quarter and year, for the roster.
   *
   * The window is part of the key even though it changes not one balance: it
   * changes `published_in_window`, which is a different ANSWER for the same
   * question, and two screens asking about two windows must not be served each
   * other's. `null` for the roster, which asks about no window at all, keeps
   * that reading distinct from any window's rather than sharing its entry.
   *
   * THE TIMEZONE IS PART OF THE KEY for the same reason the window is. The
   * server turns instants into DAYS with it, and a day boundary is where a
   * month, a quarter and a year begin -- so two zones are two different
   * answers, not one answer asked twice. It only ever changes mid-session if
   * the machine's clock does, and then the cache should indeed miss.
   */
  balances: (
    from: string | null = null,
    to: string | null = null,
    tz: string | null = null,
  ) => ['workday', 'balances', from, to, tz] as const,
  /** Which days of a year carry shifts, for the year grid; managers only. */
  shiftMarks: (year: number) => ['schedule', 'marks', year] as const,

  // Inventory, managers only. Everything under one prefix so a count or a
  // delivery saved refreshes the stock list and both histories in one
  // invalidation.
  inventory: ['inventory'] as const,
  inventoryItems: (includeArchived: boolean) =>
    ['inventory', 'items', includeArchived] as const,
  inventoryCounts: ['inventory', 'counts'] as const,
  inventoryCount: (id: string) => ['inventory', 'counts', id] as const,
  inventoryReceipts: ['inventory', 'receipts'] as const,
  inventoryReceipt: (id: string) => ['inventory', 'receipts', id] as const,
  /** Who each product is ordered from; under the prefix, so a supplier renamed refreshes the products that name it. */
  inventorySuppliers: ['inventory', 'suppliers'] as const,
  /**
   * The menu, sections and dishes in one answer. Read by the manager AND the
   * team, so it is not under the managers-only 'inventory' prefix.
   */
  menu: ['menu'] as const,
  /**
   * What each product of the menu takes from the stock; managers only. Under
   * the menu's prefix on purpose: every write to the menu refreshes the menu
   * by that prefix, so a dish added, renamed or deleted there shows here too.
   */
  recipes: ['menu', 'recipes'] as const,

  // The shop (Tienda): sales and what they add up to, managers only. One
  // prefix, so a sale saved or voided refreshes the list, its detail and the
  // statistics in one invalidation. The window is part of the list's and the
  // statistics' keys: two periods are two answers.
  store: ['store'] as const,
  storeSales: (from: string, to: string) => ['store', 'sales', from, to] as const,
  storeSale: (id: string) => ['store', 'sale', id] as const,
  storeStats: (from: string, to: string) => ['store', 'stats', from, to] as const,

  // The day notes. One prefix so a save refreshes the manager's list and the
  // reader's feed together.
  dayNotesAll: ['day-notes'] as const,
  dayNotes: ['day-notes', 'list'] as const,
  dayNoteReaders: ['day-notes', 'readers'] as const,
  dayNoteFeed: ['day-notes', 'feed'] as const,
  /** What the notes have taught the planner; managers only. */
  dayNoteInsights: ['day-notes', 'insights'] as const,

  // Back office. Namespaced under 'backoffice' so signing out of the operator
  // session can drop exactly these and leave a tenant session's cache alone.
  platformAdmin: ['backoffice', 'me'] as const,
  platformMetrics: ['backoffice', 'metrics'] as const,
  platformCustomers: (params: {
    status?: string;
    q?: string;
    offset?: number;
  }) => ['backoffice', 'customers', params] as const,
  platformCustomer: (orgId: string) =>
    ['backoffice', 'customers', orgId] as const,
};
