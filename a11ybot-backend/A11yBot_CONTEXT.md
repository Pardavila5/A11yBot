(Este archivo debe ser leido SIEMPRE antes de ayudarme)

# Rol del asistente

Actuas como asistente tecnico principal de mi Trabajo de Fin de Grado (TFG) de Ingenieria Informatica.
Tu funcion es ayudarme a disenar, implementar y documentar A11yBot: un sistema completo de auditoria automatica de accesibilidad web.

# Objetivo del proyecto

A11yBot es una aplicacion web (frontend + backend) que:

- recibe una URL desde el frontend;
- la carga en backend con Playwright;
- ejecuta una auditoria automatizada con axe-core;
- normaliza reglas y ocurrencias;
- guarda los resultados en base de datos;
- permite consultar auditorias anteriores;
- permite comparar auditorias;
- incorpora una capa IA trazable para resumenes, explicaciones y comparaciones.

# Principio academico y tecnico

- La fuente de verdad es la evidencia determinista de auditoria.
- La IA no decide cumplimiento WCAG; interpreta, resume y prioriza sobre evidencia ya generada.
- El TFG debe priorizar claridad, trazabilidad y cambios incrementales sobre complejidad innecesaria.

# Tecnologias

- Backend: NestJS + Node.js + TypeScript
- Auditoria: Playwright + @axe-core/playwright
- Persistencia: Prisma 6.x sobre SQLite en el estado actual
- Frontend: React + TypeScript + Vite
- UI: Material UI
- Formato de evidencia: JSON estructurado

# Estado actual real del proyecto

## Backend

Modulos principales:

- `AuditModule`
- `AiModule`
- `WebsiteModule`
- `PrismaModule`

Endpoints implementados:

- `POST /audits`
- `GET /audits`
- `GET /audits/:id`
- `PATCH /audits/:id`
- `DELETE /audits`
- `GET /audits/compare?old=ID&new=ID`
- `GET /audits/runtime`
- `GET /websites/:id/audits`
- `GET /ai/audits/:id/summary`
- `GET /ai/audits/:id/summary/ab`
- `GET /ai/audits/:id/rules/:ruleId/explain`
- `GET /ai/compare?old=ID&new=ID`
- `GET /ai/compare/ab?old=ID&new=ID`
- `GET /ai/traces`
- `GET /ai/traces/stats`

Capacidades implementadas:

- validacion estricta de URL y mitigacion SSRF;
- timeouts y reintentos acotados;
- limites de concurrencia global y por host;
- cola en memoria para auditorias excedentes;
- trazabilidad IA persistida en `AiTrace`;
- modo dual heuristico/OpenAI con fallback.

## Frontend

Rutas implementadas:

- `/`: dashboard
- `/audits`: historico
- `/audits/:id`: detalle
- `/compare`: comparador
- `/ops`: metricas operativas y trazas IA

Capacidades implementadas:

- lanzar auditorias;
- consultar historico paginado;
- abrir detalle completo;
- generar resumen IA y explicaciones IA;
- comparar auditorias;
- consultar runtime del backend y metricas IA.

# Alcance cerrado y pendiente

## Ya cerrado

- pipeline reproducible de auditoria;
- persistencia completa de resultados;
- comparacion entre auditorias;
- capa IA inicial con trazabilidad;
- observabilidad basica de runtime y trazas IA.

## Pendiente recomendado

- metricas persistentes por fase de auditoria;
- visualizacion A/B mas completa en frontend;
- exportes de reportes para defensa;
- endurecimiento adicional si se quisiera acercar a produccion.

# Limitaciones actuales

- El backend esta orientado a un entorno controlado de TFG, no a produccion.
- CORS esta abierto y no hay autenticacion/autorizacion.
- La cola de auditorias es en memoria, no distribuida.
- SQLite es suficiente para el alcance actual, aunque no es la opcion final mas escalable.

# Regla de trabajo

Si un documento historico entra en conflicto con `A11YBOT_MEMORY.md`, el roadmap o el codigo actual, debe priorizarse el estado mas reciente y verificable.
