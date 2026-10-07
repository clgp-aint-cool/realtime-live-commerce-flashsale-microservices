import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// `npm run dev`: chuyển /api và /ws sang Kong của docker compose (cổng 8000).
const gateway = process.env.GATEWAY_URL ?? 'http://localhost:8000';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': gateway,
      '/ws': { target: gateway, ws: true },
    },
  },
});
