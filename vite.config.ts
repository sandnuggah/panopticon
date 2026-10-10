import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'

// Which build this is (see buildId.ts). Vite reads this file once for the browser code and once
// for the server's, so the ID is made once per build process and shared through its environment.
process.env.PANOPTICON_BUILD_ID ??= Date.now().toString(36)

export default defineConfig(({ command }) => ({
  define: { __BUILD_ID__: JSON.stringify(command === 'build' ? process.env.PANOPTICON_BUILD_ID : 'dev') },
  // maplibre's worker is an ES module (see AssetMap.tsx).
  worker: { format: 'es' },
  // Builds bundle every server dependency into dist/server, so production needs no node_modules
  // apart from srvx (see Dockerfile). Not in dev: Vite's dev runner can't inline CommonJS packages.
  ...(command === 'build' ? { ssr: { noExternal: true } } : {}),
  plugins: [tailwindcss(), tanstackStart(), react()],
}))
