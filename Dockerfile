# syntax=docker/dockerfile:1

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# The build bundles every server dependency into dist/server (vite.config.ts), so the runtime
# image only needs srvx, the HTTP server that server.mjs runs.
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules/srvx ./node_modules/srvx
COPY --from=build /app/dist ./dist
COPY --from=build /app/server.mjs ./
USER node
EXPOSE 3000
# Config (TRACCAR_URL, SESSION_SECRET, …) comes from the environment; see .env.example.
CMD ["node", "server.mjs"]
