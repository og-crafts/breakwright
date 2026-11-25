import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
export default defineConfig({ plugins: [react()], build: { outDir: 'dist/ui', emptyOutDir: true, assetsInlineLimit: 0 /* the page's content policy refuses data: fonts */ }, test: { environment: 'jsdom', include: ['kit/checks/**/*.test.{ts,tsx}'] } })
