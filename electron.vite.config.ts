import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// OAuth client values are injected at build time and never committed (ADR section 8).
const define = {
  __GOOGLE_OAUTH_CLIENT_ID__: JSON.stringify(process.env.GOOGLE_OAUTH_CLIENT_ID ?? ''),
  __GOOGLE_OAUTH_CLIENT_SECRET__: JSON.stringify(process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? ''),
};

export default defineConfig({
  main: {
    define,
    build: {
      rollupOptions: {
        input: { index: resolve('src/main/index.ts'), worker: resolve('src/worker/index.ts') },
      },
    },
  },
  preload: {
    build: { rollupOptions: { input: resolve('src/preload/index.ts') } },
  },
  renderer: {
    root: 'src/renderer',
    plugins: [react()],
    build: { rollupOptions: { input: resolve('src/renderer/index.html') } },
  },
});
