// Lets Node run the app's TypeScript as Vite does: imports without an extension ('./segments') load
// the .ts file. For dev scripts (dev/replay.ts): node --import ./dev/resolve-ts.mjs dev/replay.ts
import { registerHooks } from 'node:module'

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (error) {
      if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)) return nextResolve(`${specifier}.ts`, context)
      throw error
    }
  },
})
