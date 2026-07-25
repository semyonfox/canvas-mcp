# syntax=docker/dockerfile:1.7

FROM node:26-bookworm-slim@sha256:2d49d876e96237d76de412761cf05dbfe5aee325cc4406a4d41d5824c5bb8beb AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=canvas-mcp-pnpm-store,target=/pnpm/store \
    corepack enable \
    && pnpm config set store-dir /pnpm/store \
    && pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
RUN pnpm run build && pnpm prune --prod

FROM gcr.io/distroless/nodejs24-debian12:nonroot@sha256:14d42e2511532589a7c7e01a753667a74fcc96266e137e8125006b87b0c32d0a
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
ENV NODE_ENV=production
EXPOSE 3001
USER nonroot
CMD ["dist/index.js"]
