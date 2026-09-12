import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  base: '/trombone/',
  build: { outDir: 'dist/trombone' },
  plugins: [react(), tailwindcss()],
})
