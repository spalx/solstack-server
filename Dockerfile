FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
# The CLI is not part of the image, but its manifest keeps the workspace layout matching the lockfile.
COPY client/package.json client/
RUN npm ci
COPY server server
COPY web web
RUN npm run build -w web && npm run build -w server

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
COPY client/package.json client/
RUN npm ci --omit=dev --workspace server && npm cache clean --force
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/server/migrations server/migrations
COPY --from=build /app/web/dist web/dist
USER node
EXPOSE 3000
CMD ["node", "server/dist/index.js"]
