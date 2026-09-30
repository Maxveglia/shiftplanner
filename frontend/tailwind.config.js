/** @type {import('tailwindcss').Config} */

// The palette is the design system's, restated as Tailwind scales and set
// for the dark app (see the note on `colors` below).
//
// Every colour the interface uses goes through a handful of scales, so a
// change of ground lands by redefining those scales rather than by touching
// each component -- which is what makes a screen nobody remembers (the
// backoffice, an error state, the payroll table) come out right too.
//
// The brand's menta values (300-600) are the system's tokens, unchanged:
// menta #0e7c66, menta-light #44d6b4. The rest are chosen for the dark ground
// and for contrast on it: muted text (gray-500) 7:1 on a surface, gray-400
// 5.2:1 (it is text in ~90 places, so it clears 4.5:1, not just the 3:1 of an
// edge), focus rings (brand-200) 3.4:1.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // THE APP IS DARK: it stands on the launcher's stage (StageBackdrop), all
      // of it. The scales keep their names and their ROLES and change their
      // values, so the ~1,400 colour classes across the app turn over at once
      // instead of screen by screen:
      //
      //   gray   inverted. 50 is the sunken ground, 100-300 raised fills and
      //          lines, 400 icons, edges and faint text (5.2:1), 500 muted text
      //          (7:1 on a surface), 900 ink -- now near-white. Same ladder,
      //          read from the other end.
      //   red, amber, green  50-100 dark tints (what the soft badges and
      //          warnings sit on), 200 a dim edge, 300+ light shades for text:
      //          the higher the number, the closer to white, as "more
      //          contrast" meant on paper. Complete from 50 to 950 on purpose:
      //          a step left at Tailwind's default would be a light-theme
      //          value -- green-900 dark ink on a dark card. And no step from
      //          300 up is a fill for white text: `bg-red-600 text-white` is
      //          white on light red now. Solid fills are `danger`, `brand-600`.
      //   brand  50-100 dark menta tints (the active nav, soft fills), 200 a
      //          mid menta for focus rings (3.4:1), 300-500 the menta lights
      //          as they were, 600 the brand itself -- a solid fill with white
      //          on it (5.1:1) -- and 700-900 light menta for text. Solid fills
      //          that used 700 as a darker hover use `brand-deep`.
      //
      // A value where a class meant a SOLID fill with white on it would have
      // to be dark and one meant as text light, and one number cannot be both:
      // those few fills have names of their own -- `surface` (what was white),
      // `danger`, `brand-deep`, `ground`. The light values these replace are
      // in git history (before the dark app), anchored to the design system.
      colors: {
        ground: '#0b1512', // the stage itself
        surface: '#111d1a', // a card, a panel, the sidebar -- was white
        danger: {
          DEFAULT: '#c2383b', // a destructive button, white on it 5.2:1
          hover: '#a92f32',
        },
        brand: {
          50: '#0f2a24',
          100: '#133a31',
          200: '#2f7d69',
          300: '#6ed9c0',
          400: '#44d6b4', // menta-light
          500: '#14a184',
          600: '#0e7c66', // menta -- the brand colour itself
          700: '#8fe3cf',
          800: '#b5ecde',
          900: '#d4f3eb',
          deep: '#0a6654', // primary-hover, as a fill
        },
        gray: {
          50: '#0d1815',
          100: '#15221e',
          200: '#1d2c27',
          300: '#293a35',
          400: '#82918c', // 5.2:1 on a surface: used as text in ~90 places, not only as edges
          500: '#9aa9a4',
          600: '#b4c1bd',
          700: '#cbd5d2',
          800: '#e0e6e4',
          900: '#f1f5f3',
        },
        red: {
          50: '#2b1515',
          100: '#3b1b1b',
          200: '#6b2a2a',
          300: '#fca5a5',
          400: '#f87171',
          500: '#ef4444',
          600: '#f87171',
          700: '#fca5a5',
          800: '#fecaca',
          900: '#fee2e2',
          950: '#fff1f1',
        },
        amber: {
          50: '#2a2110',
          100: '#3a2c12',
          200: '#5c4617',
          300: '#fcd34d',
          400: '#fbbf24',
          500: '#f59e0b',
          600: '#fbbf24',
          700: '#fcd34d',
          800: '#fde68a',
          900: '#fef3c7',
          950: '#fffbeb',
        },
        green: {
          50: '#0f2a1c',
          100: '#143823',
          200: '#1f5a38',
          300: '#86efac',
          400: '#4ade80',
          500: '#22c55e',
          600: '#4ade80',
          700: '#86efac',
          800: '#bbf7d0',
          900: '#dcfce7',
          950: '#f0fdf4',
        },
      },
      // Tailwind draws the gap of an offset ring in white; on this ground a
      // white halo round every focused control.
      ringOffsetColor: {
        DEFAULT: '#0b1512',
      },
      fontFamily: {
        // One family, three weights, as the system says. The fallbacks are
        // real: Figtree is loaded from Google Fonts in index.css, and a font
        // that is slow or blocked must not leave the rota in a serif.
        sans: [
          'Figtree',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
};
