# A11yBot - Roadmap de valor para el TFG

Fecha de actualizacion: 2026-03-24

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
6. Frontend con dashboard, historico, detalle, comparador y pantalla `/ops`.

### En consolidacion
1. Coherencia contractual frontend/backend y documentacion.
2. Explotacion y validacion de la visualizacion A/B del aporte IA en frontend.
3. Trazabilidad y material de apoyo para memoria y defensa.

## 4) Backlog priorizado

### P0 - Seguridad y fiabilidad
1. Endurecer mas la capa operativa si sale del entorno controlado del TFG.
2. Sustituir la cola en memoria por una cola real si se necesita mayor carga.
3. Mantener limites de concurrencia y validacion de destinos como parte del baseline.

### P1 - Calidad operativa
1. Metricas persistentes por fase: navegacion, ejecucion de axe, persistencia.
2. Logs estructurados por `auditId`, `websiteId` y `requestId`.
3. Mayor cobertura de pruebas sobre flujos y errores reales.
4. Criterios claros de verificacion frontend.

### P2 - IA util de verdad
1. Priorizacion mas rica por impacto, alcance y recurrencia.
2. Sugerencias de remediacion mas especificas por stack.
3. Mejor visualizacion de top hallazgos y muestras relevantes.
4. Resumenes comparativos mas explotables para seguimiento.

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
- Fase 1: cerrar coherencia, trazabilidad y calidad minima defendible.
- Fase 2: completar metricas por fase y visualizacion A/B.
- Fase 3: reforzar sugerencias IA y materiales para defensa.

## 6) Que mostrar en la defensa
- Pipeline completo de auditoria reproducible.
- Comparativa antes/despues y heuristico vs IA.
- Evidencia cuantitativa y cualitativa del aporte IA.
- Decisiones de arquitectura y tradeoffs bien justificados.

## 7) Siguiente fase recomendada
- Metricas persistentes por fase.
- Consolidar resultados A/B y documentarlos en memoria/defensa.
- Exportes de reportes o artefactos de apoyo para la defensa.
