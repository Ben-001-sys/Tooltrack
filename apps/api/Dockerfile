# syntax=docker/dockerfile:1
FROM node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS build
WORKDIR /app
RUN npm install --global pnpm@11.5.3
RUN apk add --no-cache openssl ca-certificates
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile
COPY apps/api apps/api
RUN pnpm prisma:generate && pnpm build:api
# Keep Prisma CLI and its dependencies for the controlled one-off migration service.
FROM node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS runtime
RUN apk add --no-cache openssl ca-certificates \
    && rm -rf /usr/local/lib/node_modules/npm /opt/yarn-* \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/yarn /usr/local/bin/yarnpkg
ENV NODE_ENV=production PORT=3001
WORKDIR /app
COPY --from=build --chown=node:node /app /app
USER node
WORKDIR /app/apps/api
EXPOSE 3001
CMD ["node", "dist/main.js"]
