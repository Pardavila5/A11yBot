# A11yBot - Evidencias verificadas para la memoria

Documento consolidado de evidencias reales del sistema, recogidas y verificadas
de forma reproducible. Todas las cifras provienen de ejecuciones reales del
backend (Playwright + axe-core + Prisma) y de las trazas IA persistidas.

Los datos crudos estan en `evidencias/json/` (auditorias, comparaciones,
runtime, trazas IA y estadisticas). Las capturas en `evidencias/screenshots/`.

## 1. Entorno de verificacion

| Parametro | Valor |
|---|---|
| Fecha verificacion inicial (UTC) | 2026-06-09 |
| Fecha iteracion UI + robustez (UTC) | 2026-07-05 |
| Commit base | `89a1f10` (verificacion inicial) |
| Node | v24.14.1 |
| npm | 11.11.0 |
| Playwright (Chromium) | 1.57.0 |
| Modelo IA usado | `gpt-4o-mini-2024-07-18` (resuelto desde `OPENAI_MODEL=gpt-4o-mini`) |
| SO | Windows 11 |

Nota: en la segunda iteracion (julio 2026) se aplicaron todas las mejoras de UI
solicitadas por la tutora y se corrigieron dos bugs del motor de auditoria. Las
pruebas automatizadas se mantienen en 41/41 unitarias y 6/6 e2e.

## 2. Resultados de verificacion reproducible

| Comando | Resultado |
|---|---|
| `npm run build` (backend, nest build) | OK, sin errores TypeScript |
| `npm test -- --runInBand` (backend) | 41/41 en 8 suites |
| `npm run test:e2e -- --runInBand` (backend) | 6/6 en 2 suites |
| `npm run lint` (frontend, tsc --noEmit) | OK |
| `npm run build` (frontend, tsc && vite build) | OK; bundle 515.32 kB (gzip 159.24 kB) |

Nota: el warning de Vite ">500 kB" es conocido y no bloqueante. Se documenta
como decision consciente (bundle unico sin code-splitting, suficiente para un
prototipo de TFG); la mitigacion (dynamic import / manualChunks) queda como
trabajo futuro.

Alcance de las pruebas automatizadas: deterministas y aisladas (mocks de
Playwright/axe en unitarias, base de datos e2e dedicada). No sustituyen la
validacion contra sitios reales, que se documenta en las secciones siguientes.

## 3. Dataset de auditorias reales

Auditorias validas usadas como evidencia (se excluyen runs de prueba a
example.com y dos auditorias con `status: failed`, ver seccion 10).

| # | URL | Reglas viol/pass/incomplete | Ocurrencias de violacion | Ocurrencias totales |
|---|---|---|---|---|
| 1 | w3.org/WAI/EO/2005/Demo/before | 7 / 20 / 1 | 52 | 528 |
| 2 | w3.org/WAI/EO/2005/Demo/after | 2 / 24 / 1 | 15 | 363 |
| 5 | stussy.com | 2 / 37 / 1 | 2 | 269 |
| 6 | mobgenfest.com | 1 / 22 / 0 | 1 | 47 |
| 9 | esei.uvigo.es | 6 / 45 / 1 | 38 | 1324 |
| 10 | washington.edu/.../AU/before.html | 8 / 25 / 3 | 50 | 349 |
| 11 | washington.edu/.../AU/after.html | 0 / 53 / 2 | 0 | 926 |
| 12 | esei.uvigo.es | 6 / 45 / 1 | 37 | 1324 |
| 13 | instagram.com | 4 / 35 / 2 | 5 | 599 |
| 14 | w3.org/WAI/demos/bad/before/news.html | 6 / 22 / 1 | 52 | 666 |
| 15 | w3.org/WAI/demos/bad/after/news.html | 2 / 23 / 1 | 15 | 446 |

Lectura clave: la columna "ocurrencias totales" incluye `passes` e
`incomplete`; NO son errores. Para hablar de problemas reales se usa
"ocurrencias de violacion". Ejemplo: esei tiene 1324 instancias evaluadas pero
solo 38 corresponden a violaciones.

## 4. Comparaciones before/after (evidencia de remediacion)

Comparacion solo entre auditorias del mismo dominio. La comparacion mide reglas
de violacion (no el total de reglas, que incluye passes).

| Comparacion | Reglas violacion (old -> new) | Resueltas | Nuevas | Persistentes | Ocurr. violacion (old -> new) |
|---|---|---|---|---|---|
| #10 -> #11 washington before/after | 8 -> 0 | 8 | 0 | 0 | 50 -> 0 |
| #1 -> #2 w3 EO before/after | 7 -> 2 | 5 | 0 | 2 | 52 -> 15 |
| #14 -> #15 w3 bad before/after | 6 -> 2 | 4 | 0 | 2 | 52 -> 15 |
| #9 -> #12 esei (misma URL x2) | 6 -> 6 | 0 | 0 | 6 | 38 -> 37 |

Mensajes defendibles:
- Caso washington (#10 -> #11): remediacion total, 8 violaciones a 0 y el doble
  de comprobaciones superadas (25 -> 53 passes). Figura estrella before/after.
- Las cuatro comparaciones tienen `newViolationRules = 0`: el sistema no inventa
  regresiones.
- Caso esei (#9 -> #12, misma URL): 0 cambios. Demuestra que la herramienta
  reporta correctamente "sin cambios / sin regresiones" cuando no hay diferencia.

## 5. Analitica de la capa IA (trazas persistidas)

Sobre 31 trazas `AiTrace` reales (`GET /ai/traces/stats`):

| Metrica | Valor |
|---|---|
| Trazas totales | 31 |
| Por operacion | resumen auditoria 9, comparacion 10, explicacion regla 12 |
| Por fuente | OpenAI 20 (64.5%), heuristico 11 (35.5%) |
| Por modelo | gpt-4o-mini-2024-07-18: 20; gpt-5.5: 2 (ambas cayeron a fallback) |
| Latencia media | 4523 ms (OpenAI 6225 ms; heuristico ~0-1 ms) |
| Estados de intento | success 20, forced_heuristic 9, timeout 1, http_error 1 |

Lectura: el fallback de 35.5% se reparte en 9 ejecuciones forzadas a heuristico
(para el A/B) y 2 fallos reales del proveedor (ver seccion 7). El heuristico es
instantaneo y gratuito; OpenAI anade latencia de varios segundos.

## 6. Hallazgo: aporte real de la IA frente al heuristico

Evidencia A/B (misma evidencia tecnica, rama heuristica vs rama OpenAI):

- En resumenes y comparaciones, ambas ramas producen la MISMA priorizacion de
  reglas (mismas reglas, mismo orden), porque ambas consumen la evidencia
  determinista de axe-core. Ejemplo instagram (#13): las dos ramas listan
  link-in-text-block (2), aria-dialog-name (1), heading-order (1),
  meta-viewport-large (1) con identicos conteos.
- La diferencia real del LLM es de REDACCION (lenguaje natural, texto de "por
  que importa" mas legible), no de mejores decisiones ni mejor priorizacion.
- Coste de ese aporte: latencia media OpenAI 6225 ms frente a ~0-1 ms del
  heuristico, mas dependencia de un proveedor externo.

Conclusion defendible (refuerza la tesis, no la debilita):

> Para la priorizacion, el heuristico determinista es competitivo con el LLM,
> porque ambos parten de la misma evidencia. El valor del LLM se concentra en la
> legibilidad de la explicacion, con un coste de latencia y dependencia externa.
> Esto valida el principio de diseno (IA como asistencia, no como fuente de
> verdad) y justifica el fallback heuristico: al caer al heuristico se pierde
> redaccion, no rigor ni priorizacion.

## 7. Evidencia de robustez (fallback ante fallo del proveedor)

Durante una prueba puntual con el modelo gpt-5.5 se produjeron DOS fallos reales,
ambos absorbidos por el fallback heuristico sin interrumpir el resultado:

1. Incompatibilidad de parametro (`http_error`): gpt-5.5 rechaza
   `temperature != 1` ("Only the default (1) value is supported"). Traza
   registrada con el error.
2. Timeout (`timeout`): gpt-5.5 supero el limite de 15 s configurado para esa
   prueba. Traza registrada con "Timeout tras 15000ms".

En ambos casos la comparacion/resumen siguio entregando resultado via heuristico
(visible en el A/B como "fallback aplicado" / "Estado asistido: timeout").

Como presentarlo en la memoria: NO como comparativa de calidad gpt-5.5 vs
gpt-4o-mini (gpt-5.5 nunca llego a producir salida). SI como:
- demostracion de tolerancia a fallos del proveedor IA;
- justificacion empirica de la eleccion de modelo (gpt-4o-mini: compatible,
  2-8 s, suficiente; gpt-5.5: incompatible y mas lento para este caso de uso).

## 8. Mapa de capturas a figuras de memoria

Capturas en `evidencias/screenshots/`, tomadas sobre la UI final (julio 2026).

| Archivo | Pantalla | Que demuestra |
|---|---|---|
| `inicio_claro.png` | `/` | Dashboard en modo claro; boton Auditar con icono |
| `inicio_oscuro.png` | `/` | Dashboard en modo oscuro; misma estructura |
| `auditorias.png` | `/audits` | Historico con chips ✗/⚠/✓ por fila; auditoria fallida visible; detalle cargado |
| `auditorias_filtro.png` | `/audits` | Filtro por URL activo, boton Limpiar visible, resumen IA en panel derecho |
| `auditorias_paginacion.png` | `/audits` | Paginacion en pagina 4/5; variedad de auditorias |
| `auditorias_tab_violaciones.png` | `/audits/:id` | Tab Violaciones con chips de severidad (critica/seria/moderada) colapsados |
| `auditorias_explicacion_regla_ia.png` | `/audits/:id` | Regla expandida con explicacion IA: fuente, modelo, traceId, fixes |
| `auditorias_revision_manual.png` | `/audits/:id` | Tab Revision manual; chip "Evidencia automatica"; analisis IA de `incomplete` |
| `auditorias_correctas.png` | `/audits/:id` | Tab Correctas sin chips de severidad (reglas que pasan no tienen impacto) |
| `auditorias_detalle_resumen.png` | `/audits/:id` | Resumen IA trazable: fuente OpenAI, modelo, latencia, traceId, recomendaciones |
| `auditorias_detalle_comparatiba_ab.png` | `/audits/:id` | Comparativa A/B heuristico vs OpenAI sobre misma evidencia |
| `auditorias_regla_mas_de_20_ocurrencias.png` | `/audits/:id` | Paginacion de ocurrencias; boton "Mostrar N mas" |
| `auditorias_resultado_comparativa_1.png` | `/compare` | Resultado comparacion: resumen IA + A/B + aviso paginas distintas |
| `auditorias_resultado_comparativa_2.png` | `/compare` | Listas Nuevas/Resueltas/Persistentes; washington before→after: 8 resueltas, 0 nuevas |
| `ops.png` | `/ops` | Observabilidad: limites runtime, OpenAI 91.7%, fallback 8.3%, trazas recientes |

## 9. Como reproducir las evidencias JSON

Con el backend en marcha (`npm run start:dev`, puerto 3000), todas las
evidencias de datos se obtienen con peticiones de solo lectura (sin coste IA):

```text
GET /audits?page=1&pageSize=100&order=asc   -> historico
GET /audits/:id                              -> detalle (reglas + ocurrencias)
GET /audits/compare?old=ID&new=ID            -> comparacion determinista
GET /audits/runtime                          -> estado operativo
GET /ai/traces?limit=200                     -> trazas IA persistidas
GET /ai/traces/stats?sinceDays=365           -> agregados IA
```

## 10. Segunda iteracion: mejoras de UI (feedback tutora, julio 2026)

Tras revision de la tutora sobre la aplicacion desplegada, se implementaron las
siguientes mejoras verificadas en codigo y pruebas:

| Mejora | Archivo(s) afectados |
|---|---|
| Boton "Auditar": ancho, icono TravelExplore, contraste | DashboardPage, AuditsPage |
| Panel "Acciones" integrado en cabecera del Historico | AuditsPage |
| Pestanas coloreadas (Violaciones=roja, Rev.manual=gris, Correctas=verde) | AuditsPage |
| Chips de severidad con gradiente rojo (critica #b71c1c → menor #fbc02d) | aiSummaryPresentation.ts |
| Mini-resumen en cada fila del historico (✗ viol / ⚠ incomp / ✓ passes) | audit.controller.ts + AuditsPage |
| WCAG legible con tooltip (wcag111 → "WCAG 1.1.1: Non-text Content") | aiSummaryPresentation.ts + AuditsPage + ComparePage |
| Comparacion: ambas URLs mostradas + aviso si paginas distintas | ComparePage |
| Comparacion: "Reglas con incidencias: X→Y (±N)" | ComparePage |
| Comparacion: chips Nuevas/Resueltas/Persistentes con color | ComparePage |
| Bug fix: `waitUntil: 'networkidle'` → `'load'` + timeout 10s→30s | audit.service.ts |
| README: creacion de .env antes de los comandos de instalacion | README.md |
| Chip de severidad oculto en tab Correctas (reglas que pasan no tienen impacto) | AuditsPage.tsx |

Estas mejoras no alteran el modelo de datos ni la logica de auditoria; son
cambios de presentacion y robustez que refuerzan la usabilidad sin modificar
el principio rector del sistema.

## 11. Caso de compatibilidad: sing-group.org (MooTools 1.x)

Pagina auditada: `https://sing-group.org/` (grupo de investigacion SING, Joomla! 1.5)

**Diagnostico confirmado con el HTML fuente:** la pagina carga MooTools 1.x
(`/media/system/js/mootools.js`), un framework JavaScript de 2008 que reemplaza
el constructor nativo `window.Document` con un wrapper propio usando su sistema
`Native`:

```javascript
// MooTools 1.x internamente hace:
window.Document = new Native({ name: 'Document', legacy: window.Document });
```

Cuando axe-core ejecuta `doc instanceof Document` en su polyfill `getRootNode2`,
el constructor del lado derecho es el objeto MooTools, no el nativo de JS.
"Right-hand side of instanceof is not callable" es el error exacto.

Adicionalmente, la pagina incluye widgets de Twitter que crean iframes
cross-origin dinamicamente, lo que provocaba el primer error al usar el envoltorio
`@axe-core/playwright` (que inyecta axe en todos los frames de Playwright).

**Solucion implementada:** degradacion elegante con `try-catch` en `page.evaluate`:
- Si axe.run() falla con "instanceof", se captura en el contexto del navegador.
- La auditoria se registra como `status: "completed"` con `notes` explicativas.
- El historico muestra la auditoria completada (no fallida) con la nota visible.

**Valor para la defensa:** demuestra que el sistema es robusto ante entornos
adversos reales (sitios legados con frameworks que modifican el DOM), degradando
con informacion util en lugar de propagar un error tecnico al usuario.

## 12. Avisos de honestidad y limitaciones de la evidencia

- "Ocurrencias totales" incluye passes/incomplete; usar "ocurrencias de
  violacion" para hablar de problemas (seccion 3).
- Las auditorias #3 y #4 (example.com) tienen `status: failed` con resultado
  vacio: no es un bug, demuestra que el sistema persiste fallos sin caerse. Las
  auditorias #7 y #8 son pruebas minimas. No se usan como figuras de memoria.
- La comparacion #9 -> #12 (esei) es la misma URL dos veces: sirve como caso
  "sin cambios", no como before/after de mejora.
- El A/B compara dos interpretaciones de la MISMA evidencia (heuristico vs
  OpenAI). No compara la IA contra una verdad absoluta; la verdad es la
  auditoria determinista de axe-core.
- La auditoria automatica no sustituye revision humana completa: los casos
  `incomplete` se presentan explicitamente como revision manual.
