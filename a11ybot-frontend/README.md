# A11yBot Frontend

Interfaz React + Vite para el backend de auditorias de accesibilidad.

## Requisitos

- Node 18+

## Instalacion

```bash
cd a11ybot-frontend
npm install
```

## Desarrollo

```bash
npm run dev
```

Por defecto sirve la app en `http://localhost:5173` y llama al backend en `http://localhost:3000`.

## Scripts

- `npm run dev`: desarrollo.
- `npm run build`: build de produccion.
- `npm run preview`: vista previa del build.
- `npm run typecheck`: verificacion estatica TypeScript.
- `npm run lint`: alias temporal al typecheck del frontend.

## Funcionalidad incluida

- Lanzar auditorias nuevas.
- Consultar historico paginado con filtros por estado y URL.
- Ver detalle completo de una auditoria.
- Solicitar resumen IA y explicaciones IA por regla.
- Comparar heuristico vs asistido mediante endpoints A/B en auditoria y comparacion.
- Comparar dos auditorias del mismo dominio y pedir resumen IA de comparacion.
- Consultar pantalla de operaciones con runtime de auditorias y metricas IA.

## Navegacion

- `/`: dashboard con formulario de auditoria y ultimas ejecuciones.
- `/audits`: historico, filtros y detalle.
- `/audits/:id`: detalle compartible de una auditoria.
- `/compare`: comparador por IDs `old` y `new`, con seleccion guiada por dominio.
- `/ops`: estado runtime del backend, trazas IA y metricas agregadas.

## Configuracion

- `VITE_API_URL` para apuntar a otro backend:

```bash
VITE_API_URL="http://localhost:3000" npm run dev
```

## Estructura rapida

- `src/main.tsx`: providers globales y router.
- `src/App.tsx`: declaracion de rutas.
- `src/layout/Layout.tsx`: shell comun y navegacion.
- `src/api.ts`: cliente HTTP al backend.
- `src/pages/DashboardPage.tsx`: alta de auditorias y ultimas ejecuciones.
- `src/pages/AuditsPage.tsx`: historico, detalle e interacciones IA.
- `src/pages/ComparePage.tsx`: comparador, resumen IA y comparativa A/B.
- `src/pages/OpsPage.tsx`: observabilidad operativa.
- `src/types.ts`: contratos de datos frontend/backend.

## Nota de build

El build de Vite puede mostrar un warning no bloqueante por bundle superior a 500 kB. Para el alcance del TFG se mantiene como limitacion aceptada; una mejora futura seria dividir chunks con carga diferida.

## URLs de prueba utiles

- `https://dequeuniversity.com/demo/mars/`
- `https://dequeuniversity.com/demo/mars-aria/`

## Contexto TFG

- Memoria operativa: `../A11YBOT_MEMORY.md`
- Roadmap: `../TFG_ROADMAP.md`
