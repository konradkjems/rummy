# Game server image. Build from the repository root:
#   docker build -f apps/server/Dockerfile -t rummy-server .
FROM node:22-slim AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile --filter "@kova/rummy-server..." \
 && pnpm --filter @kova/rummy-server build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/apps/server/dist ./dist
USER node
EXPOSE 8787
CMD ["node", "dist/main.mjs"]
