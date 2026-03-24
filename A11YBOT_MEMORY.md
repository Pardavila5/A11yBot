# Memoria operativa - A11yBot

Ultima actualizacion: 2026-03-24

## Proposito del proyecto

A11yBot es un sistema de auditoria automatica de accesibilidad web para TFG:

- Frontend en React + TypeScript (Vite).
- Backend en NestJS + TypeScript.
- Auditoria tecnica con Playwright + axe-core.
- Persistencia con Prisma sobre SQLite en el estado actual.

## Principio tecnico

- La evidencia determinista (Playwright + axe + datos normalizados) es la fuente de verdad.
- La IA se usa como capa de ayuda: explicacion, priorizacion y propuestas de remediacion.

## Documentos de referencia obligatorios

- `TFG_ROADMAP.md`: prioridades y fases del TFG.
- `a11ybot-backend/README.md`: arquitectura y endpoints backend.
- `a11ybot-frontend/README.md`: ejecucion y navegacion frontend.
- `a11ybot-backend/A11yBot_CONTEXT.md`: contexto academico y funcional del proyecto.

## Estado operativo actual

- La raiz `A11yBot/` es el punto unico de versionado del proyecto.
- El backend expone auditoria, comparacion, runtime y capa IA con trazas persistentes.
- El frontend cubre dashboard, historico, detalle, comparacion y pantalla `/ops`.
- La salida IA mantiene modo dual:
  - sin `OPENAI_API_KEY`: heuristico local estable;
  - con `OPENAI_API_KEY`: enriquecimiento remoto con fallback automatico.
- La documentacion vigente debe venir de memoria, roadmap y codigo actual; `A11yBot_CONTEXT.md` es contexto academico, no un snapshot tecnico congelado.

## Prioridades activas

1. Seguridad y fiabilidad backend (SSRF, timeouts, reintentos y cola robusta).
2. Observabilidad y calidad (metricas por fase, logs estructurados, tests).
3. IA util y evaluable para memoria (explicacion, priorizacion, sugerencias y A/B).

## Riesgos a vigilar

- Mantener alineados contratos frontend/backend y documentacion.
- No mezclar evidencia determinista con decisiones autonomas de la capa IA.
- Evitar crecimiento de infraestructura antes de cerrar la parte evaluable del TFG.
- Presentar seguridad y calidad como alcance de TFG, no como producto listo para produccion.
