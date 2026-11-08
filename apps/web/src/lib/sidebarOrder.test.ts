import { describe, expect, it } from 'vitest';
import { applyOrder, moveNextTo } from './sidebarOrder.ts';

const ids = (xs: { id: string }[]) => xs.map((x) => x.id);
const items = ['a', 'b', 'c', 'd'].map((id) => ({ id }));

describe('applyOrder', () => {
  it('keeps the default order with nothing saved', () => {
    expect(ids(applyOrder(items, undefined))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('follows the saved order, ignoring ids that are gone, and puts new items first', () => {
    expect(ids(applyOrder(items, ['c', 'gone', 'a']))).toEqual(['b', 'd', 'c', 'a']);
  });
});

describe('moveNextTo', () => {
  it('moves before or after the target', () => {
    expect(moveNextTo(['a', 'b', 'c', 'd'], 'd', 'b', false)).toEqual(['a', 'd', 'b', 'c']);
    expect(moveNextTo(['a', 'b', 'c', 'd'], 'a', 'c', true)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('leaves the list alone for itself or an unknown target', () => {
    expect(moveNextTo(['a', 'b'], 'a', 'a', true)).toEqual(['a', 'b']);
    expect(moveNextTo(['a', 'b'], 'a', 'zzz', false)).toEqual(['a', 'b']);
  });
});
