# A11yBot Backend

API NestJS para auditoria automatica de accesibilidad con Playwright + axe-core y persistencia en Prisma/SQLite.

## Requisitos

- Node 18+
- SQLite local mediante Prisma (`prisma/dev.db`)
- Chromium de Playwright (`npx playwright install chromium`)

## Configuracion y arranque

```bash
cd a11ybot-backend
npm install
npx playwright install chromium
```

Variables locales habituales en `.env`:

```bash
DATABASE_URL="file:./dev.db"
OPENAI_API_KEY=""
OPENAI_MODEL="gpt-4o-mini"
OPENAI_BASE_URL="https://api.openai.com/v1"
OPENAI_TIMEOUT_MS=15000
AUDIT_TIMEOUT_MS=10000
AUDIT_MAX_RETRIES=1
AUDIT_RETRY_DELAY_MS=500
AUDIT_MAX_CONCURRENT=2
AUDIT_MAX_CONCURRENT_PER_HOST=1
ALLOW_PRIVATE_TARGETS=false
```

Desarrollo:

```bash
npm run start:dev
```

Produccion:

```bash
npm run build
npm run start:prod
```

## Endpoints principales

- `POST /audits`: ejecuta una auditoria y persiste el resultado.
- `GET /audits`: listado paginado del historico.
- `GET /audits/:id`: detalle con reglas y ocurrencias.
- `PATCH /audits/:id`: actualiza `status` y `notes`.
- `DELETE /audits`: borra todo el historico.
- `GET /audits/compare?old=ID&new=ID`: compara dos auditorias del mismo dominio.
- `GET /audits/runtime`: estado runtime de concurrencia y cola en memoria.
- `GET /websites/:id/audits`: auditorias asociadas a un sitio.

## Endpoints IA

- `GET /ai/audits/:id/summary`: resumen IA o heuristico de una auditoria.
- `GET /ai/audits/:id/summary/ab`: comparativa A/B entre heuristico e IA para una auditoria.
- `GET /ai/audits/:id/rules/:ruleId/explain`: explicacion accionable por regla.
- `GET /ai/compare?old=ID&new=ID`: resumen IA o heuristico de una comparacion.
- `GET /ai/compare/ab?old=ID&new=ID`: comparativa A/B entre heuristico e IA para una comparacion.
- `GET /ai/traces`: ultimas trazas IA persistidas.
- `GET /ai/traces/stats`: metricas agregadas de uso, latencia y fallback.

Si `OPENAI_API_KEY` no esta definida, el backend devuelve salida heuristica local y mantiene la traza.

## Arquitectura rapida

- NestJS 11 con modulos `Audit`, `Ai`, `Website` y `Prisma`.
- `AuditService` valida URL, bloquea destinos privados, controla concurrencia en memoria, ejecuta Playwright y normaliza resultados.
- `AiService` consume la evidencia persistida, intenta enriquecimiento con OpenAI y guarda `AiTrace`.
- Prisma 6 con SQLite y tablas `Website`, `Audit`, `Rule`, `Occurrence` y `AiTrace`.
- `ValidationPipe` global con transformacion implicita.
- CORS abierto para consumo desde el frontend actual.

## Pruebas

Unitarias y e2e:

```bash
npm test
npm run test:e2e
```

Las e2e usan `prisma/dev-e2e.db` y mocks de Playwright/axe.

## Rutas de interes

- `src/main.ts`: bootstrap y middleware global.
- `src/audit/audit.service.ts`: flujo principal de auditoria.
- `src/ai/ai.service.ts`: capa IA y persistencia de trazas.
- `prisma/schema.prisma`: modelo de datos.
- `test/audit.e2e-spec.ts`: flujo backend principal.

## Limitaciones actuales

- CORS abierto para el frontend actual.
- Sin autenticacion ni autorizacion.
- Cola de auditorias en memoria.
- Enfoque orientado a TFG y entorno controlado, no a produccion.

## Contexto TFG

- Memoria operativa: `../A11YBOT_MEMORY.md`
- Roadmap: `../TFG_ROADMAP.md`
- Contexto funcional: `A11yBot_CONTEXT.md`
