import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // When this bundle was built, shown under the user in the sidebar. A manager
  // told "the fix is live" has to be able to see which build their browser is
  // actually running -- once, a Safari tab kept an old one through a reload
  // and there was no way to tell from the screen.
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  server: {
    port: 5173,
  },
});
