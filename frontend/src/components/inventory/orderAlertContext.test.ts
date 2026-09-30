import { describe, expect, it } from 'vitest';
import { cameFromOrders, itemToEdit } from './orderAlertContext';

describe('arriving from the notice', () => {
  it('is told by the router’s state, and nothing else is', () => {
    expect(cameFromOrders({ fromOrders: true })).toBe(true);
    expect(cameFromOrders({ fromOrders: 'yes' })).toBe(false);
    expect(cameFromOrders({ from: '/store' })).toBe(false);
    expect(cameFromOrders(null)).toBe(false);
    expect(cameFromOrders(undefined)).toBe(false);
  });

  it('names the product whose form Stock opens, only when the notice sent it', () => {
    expect(itemToEdit({ fromOrders: true, editItem: 'pollo' })).toBe('pollo');
    expect(itemToEdit({ fromOrders: true })).toBeNull();
    expect(itemToEdit({ fromOrders: true, editItem: '' })).toBeNull();
    expect(itemToEdit({ editItem: 'pollo' })).toBeNull();
  });
});
