import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'

export default defineConfig({
  // maplibre's worker is an ES module (see AssetMap.tsx).
  worker: { format: 'es' },
  plugins: [tanstackStart(), react()],
})
