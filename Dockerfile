# syntax=docker/dockerfile:1.7

FROM node:26-bookworm-slim@sha256:5df79989ed685e09f0a98019db4cebfb22fb9df1a53c0161664a011f7ff6b0f1 AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# node 26 no longer bundles corepack, which reads the pnpm pin from package.json
RUN --mount=type=cache,id=canvas-mcp-pnpm-store,target=/pnpm/store \
    npm install -g corepack@0.36.0 \
    && corepack enable \
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
CMD ["dist/index.js", "--http"]
