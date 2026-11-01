# Imagen única (OCI, ADR-01/ADR-09): API Fastify + SPA estática + worker de jobs.
# Construcción:  docker build -t ghcr.io/<org>/mmx-recetas:<sha> .
FROM node:22-alpine AS build
WORKDIR /src
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc turbo.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/assistant/package.json packages/assistant/
COPY packages/cimavet/package.json packages/cimavet/
COPY packages/db/package.json packages/db/
COPY packages/domain/package.json packages/domain/
COPY packages/extraction/package.json packages/extraction/
COPY packages/gs1/package.json packages/gs1/
COPY packages/reports/package.json packages/reports/
COPY packages/shared/package.json packages/shared/
COPY packages/siweb/package.json packages/siweb/
RUN pnpm install --frozen-lockfile
COPY . .
# tsup empaqueta los paquetes del workspace; las dependencias declaradas de la API (fastify, drizzle, zod…) se
# instalan aparte en modo producción. El worker usa un subconjunto de ellas.
RUN pnpm --filter @mmx/api --filter @mmx/worker --filter @mmx/web build \
 && pnpm --filter @mmx/api deploy --prod /out/api

FROM node:22-alpine
ENV NODE_ENV=production PORT=8080 WEB_DIST_DIR=/app/web TZ=UTC
WORKDIR /app
COPY --from=build /out/api/node_modules ./node_modules
COPY --from=build /src/apps/api/dist ./api
COPY --from=build /src/apps/worker/dist ./worker
COPY --from=build /src/apps/web/dist ./web
# Ficheros de datos que la app busca desde el cwd: reglas aprobadas, migraciones y prompt versionado.
COPY --from=build /src/config/rules ./config/rules
COPY --from=build /src/packages/db/migrations ./packages/db/migrations
# Guía de la receta veterinaria: fuente de referencia del asistente de consultas.
COPY --from=build /src/docs/ref/guia-receta-veterinaria.md ./docs/ref/guia-receta-veterinaria.md
USER node
EXPOSE 8080
# Por defecto la API; los Container Apps Jobs usan: node worker/worker.js <job>
CMD ["node", "api/main.js"]
