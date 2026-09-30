/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** ISO instant this bundle was built at -- see vite.config.ts. */
declare const __BUILD_TIME__: string;
