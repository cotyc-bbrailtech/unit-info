import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Served from https://<user>.github.io/unit-info/
export default defineConfig({
  base: process.env.NODE_ENV === 'production' ? '/unit-info/' : '/',
  plugins: [react()],
})
