import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dự án không cài @types/node; chỉ cần đọc biến môi trường nên khai báo tối thiểu.
declare const process: { env: Record<string, string | undefined> };

// Khi chạy dev, /api và /ws được chuyển tiếp sang Spring Boot (mặc định cổng 8080).
// Đổi backend khác: API_PROXY=http://localhost:8081 npm run dev
const apiTarget = process.env.API_PROXY ?? 'http://localhost:8080';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': apiTarget,
      '/ws': { target: apiTarget.replace(/^http/, 'ws'), ws: true },
    },
  },
});
