import { defineConfig } from 'vite';

export default defineConfig({
  base: '/aa-page/',
  root: '.',
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
