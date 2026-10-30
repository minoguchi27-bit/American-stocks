import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base: './' で GitHub Pages 等のサブパス配信にも対応
export default defineConfig({
  base: './',
  plugins: [react()],
  test: { environment: 'node' },
} as never);
