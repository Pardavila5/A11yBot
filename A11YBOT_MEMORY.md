# Memoria operativa - A11yBot

Ultima actualizacion: 2026-06-09

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
- `evidencias/EVIDENCIAS.md`: evidencias verificadas (dataset real, comparaciones, analitica IA, hallazgos y avisos de honestidad) para la memoria.

## Estado operativo actual

- La raiz `A11yBot/` es el punto unico de versionado del proyecto.
- El backend expone auditoria, comparacion, runtime y capa IA con trazas persistentes.
- El frontend cubre dashboard, historico filtrable, detalle, comparacion, visualizacion A/B de IA y pantalla `/ops`.
- La salida IA mantiene modo dual:
  - sin `OPENAI_API_KEY`: heuristico local estable;
  - con `OPENAI_API_KEY`: enriquecimiento remoto con fallback automatico.
- Los resumenes IA, explicaciones por regla y ramas A/B se apoyan en trazas persistidas para favorecer reutilizacion y trazabilidad.
- Las reglas `incomplete` se tratan como revision manual, no como fallo confirmado ni como cumplimiento.
- La documentacion vigente debe venir de memoria, roadmap y codigo actual; `A11yBot_CONTEXT.md` es contexto academico, no un snapshot tecnico congelado.

## Verificacion y hallazgos (2026-06-09)

- Verificacion reproducible OK: backend build, 41/41 unitarias, 6/6 e2e; frontend typecheck y build (warning de bundle >500 kB conocido y no bloqueante).
- Evidencia real recogida y consolidada en `evidencias/` (15 auditorias, comparaciones before/after, 31 trazas IA). Detalle en `evidencias/EVIDENCIAS.md`.
- Hallazgo IA (A/B): heuristico y OpenAI producen la misma priorizacion sobre la misma evidencia; el LLM aporta redaccion, no mejores decisiones. Refuerza "IA como asistencia" y justifica el fallback.
- Robustez demostrada: gpt-5.5 fallo por incompatibilidad de `temperature` y por timeout; el fallback heuristico siguio entregando resultado. El experimento gpt-5.5 se descarta como feature; `temperature` vuelve a 0.2 (valor afinado para gpt-4o-mini).
- Aviso de honestidad: "ocurrencias totales" incluye passes/incomplete; usar "ocurrencias de violacion" para hablar de problemas.

## Prioridades activas

1. Cierre tecnico y verificacion reproducible (builds, lint, unitarias y e2e).
2. Evidencias para memoria/defensa (capturas, trazas IA, comparativas A/B y resultados de pruebas).
3. Congelar alcance funcional salvo ajustes menores de robustez o coherencia documental.

## Riesgos a vigilar

- Mantener alineados contratos frontend/backend y documentacion.
- No mezclar evidencia determinista con decisiones autonomas de la capa IA.
- Evitar crecimiento de infraestructura antes de cerrar la parte evaluable del TFG.
- Presentar seguridad y calidad como alcance de TFG, no como producto listo para produccion.
