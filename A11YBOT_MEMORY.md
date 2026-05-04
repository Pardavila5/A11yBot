# Memoria operativa - A11yBot

Ultima actualizacion: 2026-05-04

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
- El frontend cubre dashboard, historico filtrable, detalle, comparacion, visualizacion A/B de IA y pantalla `/ops`.
- La salida IA mantiene modo dual:
  - sin `OPENAI_API_KEY`: heuristico local estable;
  - con `OPENAI_API_KEY`: enriquecimiento remoto con fallback automatico.
- Los resumenes IA, explicaciones por regla y ramas A/B se apoyan en trazas persistidas para favorecer reutilizacion y trazabilidad.
- Las reglas `incomplete` se tratan como revision manual, no como fallo confirmado ni como cumplimiento.
- La documentacion vigente debe venir de memoria, roadmap y codigo actual; `A11yBot_CONTEXT.md` es contexto academico, no un snapshot tecnico congelado.

## Prioridades activas

1. Cierre tecnico y verificacion reproducible (builds, lint, unitarias y e2e).
2. Evidencias para memoria/defensa (capturas, trazas IA, comparativas A/B y resultados de pruebas).
3. Congelar alcance funcional salvo ajustes menores de robustez o coherencia documental.

## Riesgos a vigilar

- Mantener alineados contratos frontend/backend y documentacion.
- No mezclar evidencia determinista con decisiones autonomas de la capa IA.
- Evitar crecimiento de infraestructura antes de cerrar la parte evaluable del TFG.
- Presentar seguridad y calidad como alcance de TFG, no como producto listo para produccion.
