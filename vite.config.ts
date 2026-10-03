import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const desktopBuild = mode === 'electron';

  return {
    base: desktopBuild ? './' : '/',
    plugins: [react()],
    build: {
      outDir: desktopBuild ? 'dist-electron' : 'dist',
      emptyOutDir: true,
    },
    server: {
      host: true,
      port: 5173,
    },
  };
});
