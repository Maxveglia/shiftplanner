// The two things the bench borrows from Node, declared and no more.
//
// vitest.config.ts runs every test in `environment: 'node'`, so both of these
// exist at run time. TypeScript does not know that: this repo has no
// @types/node, because the app itself is a browser bundle and nothing in it
// has ever needed one. `npm run lint` is `tsc --noEmit` over all of src, and a
// bench that broke it would be a bench somebody turns off.
//
// Adding the dependency was the other option and is the worse one. @types/node
// puts Node's entire standard library in scope for every file in the project,
// including the components -- and the first time somebody reaches for
// `Buffer` or `setImmediate` in a React component it will typecheck cleanly
// and fail in a browser. Two declarations that say exactly what this one file
// uses cannot do that.
//
// `import.meta.env` is not an alternative here: Vite only exposes variables it
// is asked to prefix, and the bench's flags are plain shell flags a person
// types in front of `npx vitest`.

/** The environment the bench's two flags arrive in -- and SP_EVALS, read by ./knownGap. */
declare const process: {
  env: Record<string, string | undefined>;
};

declare module 'node:fs' {
  /** Enough to re-pin the baseline fixture from a run, and nothing else. */
  export function writeFileSync(path: URL | string, data: string): void;
}
