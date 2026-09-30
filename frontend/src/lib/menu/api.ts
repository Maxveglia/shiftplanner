// The menu over the wire. Anyone in the workspace reads it (GET /menu); only
// a manager writes it -- the server answers an employee's write with a 403,
// and the team's screen has no way to send one anyway.
//
// A dish's photo is written apart from the dish (PUT and DELETE on its own
// address) and read by the browser itself, from `photo_url` (photo.ts).
//
// Each write puts its answer into the cached menu at once (edit.ts) and then
// refetches it, so the screen moves with the server and still ends on what
// the server holds. A reorder answers with the whole menu: that is the truth,
// taken as it is.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { queryKeys } from '../../api/keys';
import {
  dishFromServer,
  menuFromServer,
  patchDish,
  reorderDishes,
  reorderSections,
  withDish,
  withoutDish,
  withoutSection,
  withSection,
  type ServerDish,
  type ServerMenu,
} from './edit';
import type { Menu, MenuDishInput, MenuDishPatch, MenuSection } from './types';

const KEY = queryKeys.menu;
const at = (id: string) => encodeURIComponent(id);

/**
 * `live` is the team's screen: a phone left open on the menu through a
 * service, where "sold out" is switched on the manager's side. The app does
 * not refetch on focus by default (main.tsx), so without this the waiter
 * would go on offering the dish until a reload. A minute apart, and only
 * while the page is in front (react-query pauses the interval in the
 * background); a whole menu is at most 500 dishes.
 */
export function useMenu({ live = false }: { live?: boolean } = {}) {
  return useQuery({
    queryKey: KEY,
    queryFn: async () => {
      const { data } = await api.get<ServerMenu>('/menu');
      return menuFromServer(data);
    },
    ...(live ? { refetchOnWindowFocus: true, refetchInterval: 60_000 } : {}),
  });
}

/**
 * A write whose answer is folded into the cached menu by `apply`, followed
 * by a refetch. The refetch is not waited for: the answer is already on
 * screen, and the dialog that sent it can close.
 */
function useMenuWrite<V, R>(send: (vars: V) => Promise<R>, apply: (menu: Menu, answer: R, vars: V) => Menu) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: send,
    onSuccess: (answer, vars) => {
      qc.setQueryData<Menu>(KEY, (menu) => (menu ? apply(menu, answer, vars) : menu));
      void qc.invalidateQueries({ queryKey: KEY });
    },
    // A refusal is news about the menu too: "that section is no longer on the
    // menu" (another tab, another manager deleted it) with the section still
    // on screen would be said again at every try.
    onError: () => {
      void qc.invalidateQueries({ queryKey: KEY });
    },
  });
}

export function useCreateMenuSection() {
  return useMenuWrite(
    async (vars: { name: string }) => (await api.post<MenuSection>('/menu/sections', vars)).data,
    (menu, section) => withSection(menu, section),
  );
}

export function useRenameMenuSection() {
  return useMenuWrite(
    async ({ id, name }: { id: string; name: string }) =>
      (await api.patch<MenuSection>(`/menu/sections/${at(id)}`, { name })).data,
    (menu, section) => withSection(menu, section),
  );
}

export function useDeleteMenuSection() {
  return useMenuWrite(
    async (id: string) => {
      await api.delete(`/menu/sections/${at(id)}`);
    },
    (menu, _answer, id) => withoutSection(menu, id),
  );
}

export function useCreateMenuDish() {
  return useMenuWrite(
    async (vars: MenuDishInput) => dishFromServer((await api.post<ServerDish>('/menu/dishes', vars)).data),
    (menu, dish) => withDish(menu, dish),
  );
}

export function useUpdateMenuDish() {
  return useMenuWrite(
    async ({ id, ...patch }: MenuDishPatch & { id: string }) =>
      dishFromServer((await api.patch<ServerDish>(`/menu/dishes/${at(id)}`, patch)).data),
    (menu, dish) => withDish(menu, dish),
  );
}

export function useDeleteMenuDish() {
  return useMenuWrite(
    async (id: string) => {
      await api.delete(`/menu/dishes/${at(id)}`);
    },
    (menu, _answer, id) => withoutDish(menu, id),
  );
}

/**
 * A dish's photo, already reduced (shrinkPhoto.ts), sent as the body with its
 * own type: the server answers with the dish and a new `photo_url`, which
 * replaces the old one in the cached menu -- a new address, so every <img>
 * of the dish loads the new photo and no cache serves the old one.
 */
export function useSetDishPhoto() {
  return useMenuWrite(
    async ({ id, photo }: { id: string; photo: Blob }) =>
      dishFromServer(
        (
          await api.put<ServerDish>(`/menu/dishes/${at(id)}/photo`, photo, {
            headers: { 'Content-Type': photo.type || 'image/jpeg' },
          })
        ).data,
      ),
    (menu, dish) => withDish(menu, dish),
  );
}

/**
 * Takes a dish's photo off: from then on its tile is the light one, with its
 * name printed -- and nothing is "labelled" without a photo.
 */
export function useRemoveDishPhoto() {
  return useMenuWrite(
    async (id: string) => {
      await api.delete(`/menu/dishes/${at(id)}/photo`);
    },
    (menu, _answer, id) => patchDish(menu, id, { photo_url: null, photo_labelled: false }),
  );
}

/**
 * The sold-out switch. Flipped on screen before the server answers -- a
 * switch that waits for the network under a thumb reads as one that did not
 * take -- and flipped back, for that one dish, if the server refuses.
 */
export function useSetDishAvailable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, available }: { id: string; available: boolean }) =>
      dishFromServer((await api.patch<ServerDish>(`/menu/dishes/${at(id)}`, { available })).data),
    onMutate: async ({ id, available }) => {
      await qc.cancelQueries({ queryKey: KEY });
      qc.setQueryData<Menu>(KEY, (menu) => (menu ? patchDish(menu, id, { available }) : menu));
    },
    onError: (_error, { id, available }) => {
      qc.setQueryData<Menu>(KEY, (menu) => (menu ? patchDish(menu, id, { available: !available }) : menu));
    },
    onSuccess: (dish) => {
      qc.setQueryData<Menu>(KEY, (menu) => (menu ? withDish(menu, dish) : menu));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/**
 * A reorder, shown at once and sent as the complete list of ids. The server
 * refuses a list that is not exactly what it holds (menu_order_mismatch: the
 * menu changed meanwhile, in another tab or another manager's hands); then
 * the screen goes back to what it was and fetches what the server has.
 */
function useReorder<V>(
  send: (vars: V) => Promise<Menu>,
  preview: (menu: Menu, vars: V) => Menu,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: send,
    onMutate: async (vars: V) => {
      await qc.cancelQueries({ queryKey: KEY });
      const before = qc.getQueryData<Menu>(KEY);
      if (before) qc.setQueryData<Menu>(KEY, preview(before, vars));
      return { before };
    },
    onError: (_error, _vars, context) => {
      if (context?.before) qc.setQueryData<Menu>(KEY, context.before);
      void qc.invalidateQueries({ queryKey: KEY });
    },
    onSuccess: (menu) => {
      qc.setQueryData<Menu>(KEY, menu);
    },
  });
}

export function useReorderMenuSections() {
  return useReorder(
    async (ids: string[]) => menuFromServer((await api.put<ServerMenu>('/menu/sections/order', { ids })).data),
    (menu, ids) => reorderSections(menu, ids),
  );
}

export function useReorderMenuDishes() {
  return useReorder(
    async ({ sectionId, ids }: { sectionId: string; ids: string[] }) =>
      menuFromServer((await api.put<ServerMenu>(`/menu/sections/${at(sectionId)}/dishes/order`, { ids })).data),
    (menu, { sectionId, ids }) => reorderDishes(menu, sectionId, ids),
  );
}
