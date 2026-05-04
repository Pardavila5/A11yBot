# A11yBot - Roadmap de valor para el TFG

Fecha de actualizacion: 2026-05-04

## 1) Objetivo tecnico y academico
- Construir una herramienta fiable de auditoria de accesibilidad basada en evidencia (`Playwright + axe-core + persistencia`).
- Demostrar aporte diferencial de IA sin comprometer trazabilidad ni rigor tecnico.

## 2) Principio de diseno
- La fuente de verdad es el resultado determinista de auditoria.
- La IA se usa como capa de asistencia: interpretacion, priorizacion y propuesta de accion.
- La IA no decide si una regla cumple o no cumple; eso lo decide el motor de auditoria.

## 3) Estado actual resumido

### Ya implementado
1. Backend de auditoria con persistencia completa.
2. Comparacion entre auditorias del mismo dominio.
3. Validacion de URL, mitigacion SSRF, timeouts, reintentos y limites de concurrencia.
4. Runtime operativo en `GET /audits/runtime`.
5. Capa IA con resumen por auditoria, explicacion por regla, resumen de comparacion, endpoints A/B, trazas persistidas y metricas agregadas.
6. Frontend con dashboard, historico filtrable, detalle, comparador, visualizacion A/B y pantalla `/ops`.
7. Reutilizacion de artefactos IA persistidos para resumenes, explicaciones por regla y comparativas A/B.
8. Tests unitarios/e2e reforzados y configuracion TypeScript mas estricta en backend.

### En consolidacion
1. Congelar alcance funcional y evitar funcionalidades grandes nuevas.
2. Preparar evidencias de ejecucion, capturas y resultados A/B para memoria/defensa.
3. Redactar la memoria con limitaciones y decisiones tecnicas bien justificadas.

## 4) Backlog priorizado

### P0 - Seguridad y fiabilidad
1. Endurecer mas la capa operativa si sale del entorno controlado del TFG.
2. Sustituir la cola en memoria por una cola real si se necesita mayor carga.
3. Mantener limites de concurrencia y validacion de destinos como parte del baseline.

### P1 - Calidad operativa
1. Mantener verificaciones reproducibles: backend build/lint/test/e2e y frontend lint/build.
2. Documentar resultados de pruebas y capturas de los flujos principales.
3. Dejar como trabajo futuro las metricas persistentes por fase y logs estructurados completos.

### P2 - IA util de verdad
1. Conservar el uso de IA como asistencia trazable, no como fuente de verdad.
2. Usar la comparativa A/B ya implementada como evidencia del aporte IA.
3. Dejar como mejora futura sugerencias mas especificas por stack.

### P3 - Evaluacion del aporte IA para la memoria
1. Diseno A/B de flujo sin IA vs con IA.
2. KPIs:
   - tiempo medio de resolucion,
   - tasa de regresion entre auditorias,
   - porcentaje de sugerencias IA aceptadas,
   - percepcion de utilidad.
3. Panel o evidencias exportables para defensa.
4. Capturas y resultados comparables usando la UI A/B ya integrada en frontend.

## 5) Propuesta de cierre incremental
- Fase 1: cerrar coherencia, trazabilidad y calidad minima defendible. Estado: practicamente cerrado.
- Fase 2: validar la visualizacion A/B y recopilar evidencias. Estado: siguiente accion.
- Fase 3: redactar memoria y preparar defensa. Estado: siguiente bloque de trabajo.

## 6) Que mostrar en la defensa
- Pipeline completo de auditoria reproducible.
- Comparativa antes/despues y heuristico vs IA.
- Evidencia cuantitativa y cualitativa del aporte IA.
- Decisiones de arquitectura y tradeoffs bien justificados.

## 7) Siguiente fase recomendada
- Ejecutar la herramienta con 2-3 URLs controladas y guardar capturas.
- Documentar resultados A/B y trazas IA en la memoria.
- Redactar limitaciones: sin auth, CORS abierto, cola en memoria, SQLite y alcance TFG.
