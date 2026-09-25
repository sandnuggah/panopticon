import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'

export default defineConfig({
  server: {
    // Vite's dev server refuses to serve any file whose path contains ":", and this
    // project's folder name has one. Dev-only; production builds are unaffected.
    // Remove this if the folder is renamed.
    fs: { strict: false },
  },
  plugins: [tanstackStart(), react()],
})
