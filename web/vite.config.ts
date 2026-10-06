import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

const server = 'http://localhost:3000';

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    // In development the browser only talks to Vite, so cookies and OAuth callbacks share one origin.
    proxy: { '/api': server, '/mcp': server, '/healthz': server },
  },
});
