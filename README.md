# A11yBot

A11yBot es un TFG orientado a auditoria automatica de accesibilidad web con evidencia tecnica reproducible y una capa IA trazable.

## Estructura

- `a11ybot-backend/`: API NestJS, motor de auditoria con Playwright + axe-core, Prisma y trazas IA.
- `a11ybot-frontend/`: interfaz React + Vite para lanzar auditorias, revisar historico, comparar ejecuciones y consultar metricas operativas.
- `A11YBOT_MEMORY.md`: memoria operativa corta del proyecto.
- `TFG_ROADMAP.md`: backlog priorizado y fases del TFG.

## Stack

- Backend: NestJS, TypeScript, Prisma, SQLite, Playwright, axe-core.
- Frontend: React, TypeScript, Vite, Material UI.
- IA: capa opcional via OpenAI con fallback heuristico, persistencia de `AiTrace` y comparativa A/B visible en frontend.

## Arranque rapido

Backend:

```bash
cd a11ybot-backend
npm install
npx prisma generate
npx prisma migrate deploy
npx playwright install chromium
npm run start:dev
```

Antes del primer arranque, crea `a11ybot-backend/.env` con al menos:

```bash
DATABASE_URL="file:./dev.db"
OPENAI_API_KEY=""
```

Frontend:

```bash
cd a11ybot-frontend
npm install
npm run dev
```

Verificacion recomendada antes de congelar cambios:

```bash
cd a11ybot-backend
npm run build
npm test -- --runInBand
npm run test:e2e -- --runInBand

cd ../a11ybot-frontend
npm run lint
npm run build
```

## Objetivo del repositorio

La raiz del workspace es ahora el punto unico de versionado del TFG. El codigo, la documentacion tecnica y la memoria de proyecto deben evolucionar juntos y con cambios incrementales.

## Limitaciones actuales

- El proyecto esta orientado a un entorno controlado de TFG.
- El backend no incorpora autenticacion ni autorizacion.
- La cola de auditorias actual es en memoria.
- SQLite cubre bien el estado actual, pero no es la opcion final mas escalable.
- La capa IA es asistiva y trazable; no sustituye la evidencia determinista de Playwright + axe-core.
