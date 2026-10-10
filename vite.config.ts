import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'

export default defineConfig(({ command }) => ({
  // maplibre's worker is an ES module (see AssetMap.tsx).
  worker: { format: 'es' },
  // Builds bundle every server dependency into dist/server, so production needs no node_modules
  // apart from srvx (see Dockerfile). Not in dev: Vite's dev runner can't inline CommonJS packages.
  ...(command === 'build' ? { ssr: { noExternal: true } } : {}),
  plugins: [tailwindcss(), tanstackStart(), react()],
}))
