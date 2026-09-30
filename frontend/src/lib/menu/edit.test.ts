import { describe, expect, it } from 'vitest';
import {
  dishFromServer,
  focusAfterMove,
  menuFromServer,
  moveId,
  patchDish,
  reorderDishes,
  reorderSections,
  withDish,
  withoutDish,
  withoutSection,
  withSection,
} from './edit';
import type { Menu, MenuDish } from './types';

function dish(id: string, sectionId: string, position: number): MenuDish {
  return {
    id,
    section_id: sectionId,
    name: id,
    description: null,
    price: null,
    allergens: [],
    available: true,
    position,
    photo_url: null,
    photo_labelled: false,
  };
}

const MENU: Menu = {
  sections: [
    { id: 'a', name: 'Entrantes', position: 0, dishes: [dish('a1', 'a', 0), dish('a2', 'a', 1), dish('a3', 'a', 2)] },
    { id: 'b', name: 'Postres', position: 1, dishes: [dish('b1', 'b', 0)] },
  ],
};

const shape = (menu: Menu) => menu.sections.map((s) => [s.id, s.dishes.map((d) => d.id)]);

describe('moveId', () => {
  it('swaps with the neighbour', () => {
    expect(moveId(['x', 'y', 'z'], 1, -1)).toEqual(['y', 'x', 'z']);
    expect(moveId(['x', 'y', 'z'], 1, 1)).toEqual(['x', 'z', 'y']);
  });

  it('refuses to leave the list', () => {
    expect(moveId(['x', 'y'], 0, -1)).toBeNull();
    expect(moveId(['x', 'y'], 1, 1)).toBeNull();
    expect(moveId(['x'], 5, -1)).toBeNull();
  });
});

describe('focusAfterMove', () => {
  it('keeps the focus on the arrow pressed while the row can go on moving', () => {
    expect(focusAfterMove(2, -1, 4)).toBe('up');
    expect(focusAfterMove(1, 1, 4)).toBe('down');
  });

  it('hands it to the other arrow once the row reaches the end', () => {
    expect(focusAfterMove(1, -1, 4)).toBe('down');
    expect(focusAfterMove(2, 1, 4)).toBe('up');
    expect(focusAfterMove(1, -1, 2)).toBe('down');
    expect(focusAfterMove(0, 1, 2)).toBe('up');
  });
});

describe('reorder', () => {
  it('puts the sections in the order of the ids and renumbers them', () => {
    const next = reorderSections(MENU, ['b', 'a']);
    expect(next.sections.map((s) => [s.id, s.position])).toEqual([
      ['b', 0],
      ['a', 1],
    ]);
  });

  it('reorders the dishes of one section only', () => {
    const next = reorderDishes(MENU, 'a', ['a3', 'a1', 'a2']);
    expect(shape(next)).toEqual([
      ['a', ['a3', 'a1', 'a2']],
      ['b', ['b1']],
    ]);
    expect(next.sections[0].dishes.map((d) => d.position)).toEqual([0, 1, 2]);
    expect(next.sections[1]).toBe(MENU.sections[1]);
  });
});

describe('withSection / withoutSection', () => {
  it('adds a new section at the end', () => {
    const next = withSection(MENU, { id: 'c', name: 'Bebidas', position: 2, dishes: [] });
    expect(shape(next)).toEqual([
      ['a', ['a1', 'a2', 'a3']],
      ['b', ['b1']],
      ['c', []],
    ]);
  });

  it('renames in place and keeps the dishes it has', () => {
    const next = withSection(MENU, { id: 'a', name: 'Para picar', position: 0, dishes: [] });
    expect(next.sections[0].name).toBe('Para picar');
    expect(next.sections[0].dishes).toHaveLength(3);
  });

  it('takes a section off with its dishes', () => {
    expect(shape(withoutSection(MENU, 'a'))).toEqual([['b', ['b1']]]);
  });
});

describe('withDish / withoutDish / patchDish', () => {
  it('adds a new dish at the end of its section', () => {
    expect(shape(withDish(MENU, dish('b2', 'b', 1)))).toEqual([
      ['a', ['a1', 'a2', 'a3']],
      ['b', ['b1', 'b2']],
    ]);
  });

  it('replaces an edited dish where it is', () => {
    const next = withDish(MENU, { ...dish('a2', 'a', 1), name: 'Croquetas' });
    expect(shape(next)).toEqual(shape(MENU));
    expect(next.sections[0].dishes[1].name).toBe('Croquetas');
  });

  it('moves a dish to the end of the section it now belongs to', () => {
    expect(shape(withDish(MENU, dish('a1', 'b', 1)))).toEqual([
      ['a', ['a2', 'a3']],
      ['b', ['b1', 'a1']],
    ]);
  });

  it('takes a dish off', () => {
    expect(shape(withoutDish(MENU, 'a2'))).toEqual([
      ['a', ['a1', 'a3']],
      ['b', ['b1']],
    ]);
  });

  it('marks one dish sold out and leaves the rest alone', () => {
    const next = patchDish(MENU, 'a3', { available: false });
    expect(next.sections[0].dishes.map((d) => d.available)).toEqual([true, true, false]);
    expect(next.sections[1]).toBe(MENU.sections[1]);
    expect(MENU.sections[0].dishes[2].available).toBe(true);
  });

  it('takes one dish’s photo off, and a new photo arrives with the dish the server answers', () => {
    const PHOTO = '/api/v1/menu/photos/p1';
    const withPhoto = withDish(MENU, { ...dish('a2', 'a', 1), photo_url: PHOTO });
    expect(withPhoto.sections[0].dishes.map((d) => d.photo_url)).toEqual([null, PHOTO, null]);
    const without = patchDish(withPhoto, 'a2', { photo_url: null });
    expect(without.sections[0].dishes[1].photo_url).toBeNull();
    expect(without.sections[0].dishes[1].name).toBe('a2');
    expect(withPhoto.sections[0].dishes[1].photo_url).toBe(PHOTO);
  });

  it('takes the label off with the photo', () => {
    const labelled = withDish(MENU, { ...dish('a2', 'a', 1), photo_url: '/api/v1/menu/photos/p1', photo_labelled: true });
    const without = patchDish(labelled, 'a2', { photo_url: null, photo_labelled: false });
    expect(without.sections[0].dishes[1]).toMatchObject({ photo_url: null, photo_labelled: false });
  });
});

describe('dishFromServer / menuFromServer', () => {
  const { photo_labelled: _dropped, ...bare } = { ...dish('a1', 'a', 0), photo_url: '/api/v1/menu/photos/p1' };

  it('reads a server from before photo_labelled as false', () => {
    expect(dishFromServer(bare).photo_labelled).toBe(false);
    expect(dishFromServer({ ...bare, photo_labelled: null }).photo_labelled).toBe(false);
  });

  it('keeps the label the server sends', () => {
    expect(dishFromServer({ ...bare, photo_labelled: true }).photo_labelled).toBe(true);
    expect(dishFromServer({ ...bare, photo_labelled: false }).photo_labelled).toBe(false);
  });

  it('never has a dish without a photo labelled', () => {
    expect(dishFromServer({ ...bare, photo_url: null, photo_labelled: true }).photo_labelled).toBe(false);
  });

  it('goes through every dish of every section, and leaves the rest as it came', () => {
    const menu = menuFromServer({
      sections: [
        { id: 'a', name: 'Entrantes', position: 0, dishes: [bare, { ...bare, id: 'a2', photo_labelled: true }] },
        { id: 'b', name: 'Vacía', position: 1, dishes: [] },
      ],
    });
    expect(menu.sections.map((s) => [s.id, s.name, s.dishes.map((d) => [d.id, d.photo_labelled])])).toEqual([
      ['a', 'Entrantes', [['a1', false], ['a2', true]]],
      ['b', 'Vacía', []],
    ]);
    expect(menu.sections[0].dishes[0]).toEqual({ ...bare, photo_labelled: false });
  });
});
