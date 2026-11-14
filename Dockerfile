# Mind2Matter · Mercado Livre Intelligence — imagem de produção (API + interface no mesmo processo)
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY server/package.json server/package-lock.json server/
COPY web/package.json web/package-lock.json web/
RUN npm --prefix server ci && npm --prefix web ci
COPY . .
RUN npm --prefix web run build && npm --prefix server prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=4000 DATA_DIR=/data
WORKDIR /app
COPY --from=build /app/server ./server
COPY --from=build /app/web/dist ./web/dist
WORKDIR /app/server
EXPOSE 4000
CMD ["node", "--disable-warning=ExperimentalWarning", "src/index.ts"]
