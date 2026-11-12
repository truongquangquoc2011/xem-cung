import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Khi chạy dev, /api và /ws được chuyển tiếp sang Spring Boot ở cổng 8080.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8080',
      '/ws': { target: 'ws://localhost:8080', ws: true },
    },
  },
});
