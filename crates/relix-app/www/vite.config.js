import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';

export default defineConfig({
  plugins: [wasm()],
  build: {
    target: 'esnext',
    minify: true,
    sourcemap: false,
    rollupOptions: {
      onwarn(warning, warn) {
        if (warning.code === 'EVAL' && warning.id?.endsWith('/src/wasm/relix_app.js')) {
          return;
        }
        warn(warning);
      },
    },
  },
  server: {
    port: 4173,
    open: false,
    fs: {
      strict: false,
      allow: ['..'],
    },
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
  },
  optimizeDeps: {
    exclude: ['./src/wasm'],
  },
});
