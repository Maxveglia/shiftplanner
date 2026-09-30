// The shop's chart colour, kept in one file so a colour is never picked at
// the call site.
//
// One series everywhere -- takings -- so one hue, and no legend: each chart's
// title says what it plots. Blue, the first slot of the data-viz palette's
// dark steps, and deliberately NOT the shop's violet (lib/apps.ts, APP_LOOK)
// nor the brand's menta: those dress the chrome -- the sidebar, the buttons,
// the focus rings -- and a bar in them reads as something to press rather
// than as "this much". The back office charts in the same family of blue
// (components/backoffice/viz.ts) for the same reason.
//
// Checked with the palette validator against the app's surface (#111d1a,
// tailwind.config.js), dark mode: inside the lightness band (OKLCH L
// 0.48-0.67), above the chroma floor, and 4.75:1 against the surface, so a
// bar holds 3:1 without a border. The app has no light theme; were one added,
// this would need its own light step (#2a78d6) validated against that ground.
export const SALES_COLOR = '#3987e5';
