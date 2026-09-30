import { describe, expect, it } from 'vitest';
import {
  dishInitials,
  fitWithin,
  PHOTO_MAX_BYTES,
  PHOTO_MAX_SIDE,
  PHOTO_QUALITIES,
  photoSrc,
  photoWrite,
  tileFace,
} from './photo';

describe('fitWithin', () => {
  it('brings a phone photo down to 800 px on its longest side, keeping the proportions', () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(3024, 4032)).toEqual({ width: 600, height: 800 });
    expect(fitWithin(3000, 3000)).toEqual({ width: 800, height: 800 });
  });

  it('never enlarges a small photo', () => {
    expect(fitWithin(187, 187)).toEqual({ width: 187, height: 187 });
    expect(fitWithin(800, 300)).toEqual({ width: 800, height: 300 });
  });

  it('rounds to whole pixels and never to zero', () => {
    expect(fitWithin(1000, 333)).toEqual({ width: 800, height: 266 });
    expect(fitWithin(10_000, 1)).toEqual({ width: 800, height: 1 });
  });

  it('takes another ceiling when given one', () => {
    expect(fitWithin(1600, 1200, 400)).toEqual({ width: 400, height: 300 });
  });

  it('refuses an image with no size', () => {
    expect(fitWithin(0, 100)).toBeNull();
    expect(fitWithin(100, Number.NaN)).toBeNull();
    expect(fitWithin(-5, 100)).toBeNull();
    expect(fitWithin(Number.POSITIVE_INFINITY, 100)).toBeNull();
  });

  it('keeps the ceiling and the qualities the server and the spec agree on', () => {
    expect(PHOTO_MAX_SIDE).toBe(800);
    expect(PHOTO_MAX_BYTES).toBe(524_288);
    expect(PHOTO_QUALITIES[0]).toBe(0.85);
    // Each try smaller than the last, or a retry could be the same size.
    expect([...PHOTO_QUALITIES].sort((a, b) => b - a)).toEqual(PHOTO_QUALITIES);
  });
});

describe('photoSrc', () => {
  const PATH = '/api/v1/menu/photos/5f0c2a4e-1111-4222-8333-944445555666';

  it('puts the path on the API origin of a developer machine', () => {
    expect(photoSrc(PATH, 'http://localhost:8000')).toBe(`http://localhost:8000${PATH}`);
    expect(photoSrc(PATH, 'http://localhost:8011/')).toBe(`http://localhost:8011${PATH}`);
  });

  it('leaves it relative in production, where the page and the API share an origin', () => {
    expect(photoSrc(PATH, '')).toBe(PATH);
  });

  it('adds the slash a path without one lacks', () => {
    expect(photoSrc('api/v1/menu/photos/x', 'http://localhost:8000')).toBe('http://localhost:8000/api/v1/menu/photos/x');
  });

  it('takes a whole address or a data: preview as it is', () => {
    expect(photoSrc('https://cdn.example/x.jpg', 'http://localhost:8000')).toBe('https://cdn.example/x.jpg');
    expect(photoSrc('data:image/jpeg;base64,AAAA', '')).toBe('data:image/jpeg;base64,AAAA');
  });

  it('is null for a dish without a photo', () => {
    expect(photoSrc(null, 'http://localhost:8000')).toBeNull();
    expect(photoSrc(undefined, '')).toBeNull();
    expect(photoSrc('', '')).toBeNull();
  });
});

describe('dishInitials', () => {
  it('takes the first letter of the first two words', () => {
    expect(dishInitials('Crispy Grande')).toBe('CG');
    expect(dishInitials('Combo Crispy Pequeño')).toBe('CC');
    expect(dishInitials('Crispy XL')).toBe('CX');
  });

  it('skips the small words nobody knows a dish by', () => {
    expect(dishInitials('Tarta de queso')).toBe('TQ');
    expect(dishInitials('Croquetas de jamón')).toBe('CJ');
    expect(dishInitials('El del Puerto')).toBe('P');
    expect(dishInitials('Fish and chips')).toBe('FC');
  });

  it('gives one letter for one word', () => {
    expect(dishInitials('Agua')).toBe('A');
    expect(dishInitials('caprisun')).toBe('C');
  });

  it('splits on hyphens and dashes', () => {
    expect(dishInitials('Coca-Cola')).toBe('CC');
    expect(dishInitials('Menú — mediodía')).toBe('MM');
  });

  it('keeps accents and eñes whole, however they were typed', () => {
    expect(dishInitials('ñoquis')).toBe('Ñ');
    // "N" and a combining tilde: one letter once composed.
    expect(dishInitials('Ñoquis a la crema')).toBe('ÑC');
    expect(dishInitials('Ébano ácido')).toBe('ÉÁ');
  });

  it('reads past symbols and emoji at the start of a word', () => {
    expect(dishInitials('🍔 Burger')).toBe('B');
    expect(dishInitials('«Especial» de la casa')).toBe('EC');
    expect(dishInitials('7 Up')).toBe('7U');
  });

  it('keeps the small words when the name is nothing else', () => {
    expect(dishInitials('De la casa')).toBe('C');
    expect(dishInitials('Y')).toBe('Y');
  });

  it('falls back to the first character of a name without letters', () => {
    expect(dishInitials('¿?')).toBe('¿');
    expect(dishInitials('   ')).toBe('');
  });
});

describe('photoWrite', () => {
  it('sends a new photo whether or not there was one', () => {
    expect(photoWrite({ kind: 'new', blob: 'b', preview: 'data:' }, false)).toEqual({ kind: 'put', blob: 'b' });
    expect(photoWrite({ kind: 'new', blob: 'b', preview: 'data:' }, true)).toEqual({ kind: 'put', blob: 'b' });
  });

  it('removes the photo only when the dish has one', () => {
    expect(photoWrite({ kind: 'none' }, true)).toEqual({ kind: 'delete' });
    expect(photoWrite({ kind: 'none' }, false)).toBeNull();
  });

  it('sends nothing when the photo was left alone', () => {
    expect(photoWrite({ kind: 'keep' }, true)).toBeNull();
    expect(photoWrite({ kind: 'keep' }, false)).toBeNull();
  });
});

describe('tileFace', () => {
  it('prints the name over a photo the manager uploaded', () => {
    expect(tileFace(true, false)).toEqual({ light: false, printName: true });
  });

  it('does not print it again over a photo that has it already', () => {
    expect(tileFace(true, true)).toEqual({ light: false, printName: false });
  });

  it('is the light tile with the name when there is no photo, or it did not load', () => {
    expect(tileFace(false, false)).toEqual({ light: true, printName: true });
    // A labelled photo that failed: the name was only in the picture.
    expect(tileFace(false, true)).toEqual({ light: true, printName: true });
  });
});
