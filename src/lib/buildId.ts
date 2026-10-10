// Which build of panopticon this is: set by Vite when it builds (vite.config.ts), the same in the
// server and the browser code of one build, and 'dev' on the dev server. The server sends its own
// with the live stream (live.server.ts), so a page left open across a new release can tell (see
// useLiveAssets.ts).

declare const __BUILD_ID__: string

export const BUILD_ID: string = __BUILD_ID__
