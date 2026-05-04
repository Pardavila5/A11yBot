process.env.DATABASE_URL = `file:./dev-e2e-audit-${process.pid}.db`;

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { AxeResultsByType } from '../src/common/interfaces/axe-result.interface';
import request from 'supertest';
import type { App as SuperTestApp } from 'supertest/types';
import { prepareE2eDatabase } from './e2e-db';

// Mocks auto-contenidos (evitan problemas de hoisting)
jest.mock('playwright', () => {
  const mockPage = {
    goto: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
  };
  const mockContext = {
    newPage: jest.fn().mockResolvedValue(mockPage),
    close: jest.fn().mockResolvedValue(undefined),
  };
  const mockBrowser = {
    newContext: jest.fn().mockResolvedValue(mockContext),
    close: jest.fn().mockResolvedValue(undefined),
  };
  return {
    chromium: {
      launch: jest.fn().mockResolvedValue(mockBrowser),
    },
    __mock: { mockPage, mockContext, mockBrowser },
  };
});

jest.mock('@axe-core/playwright', () => {
  const axeQueue: AxeResultsByType[] = [];
  const analyzeMock = jest.fn(async () => {
    return axeQueue.shift() ?? { violations: [], passes: [], incomplete: [] };
  });
  return {
    AxeBuilder: jest.fn().mockImplementation(() => ({
      analyze: analyzeMock,
    })),
    __mock: { axeQueue, analyzeMock },
  };
});

describe('Audits e2e', () => {
  let app: INestApplication | undefined;
  let httpServer: SuperTestApp;
  let prisma: PrismaClient | undefined;
  const playwrightMock = jest.requireMock('playwright');
  const axeMock = jest.requireMock('@axe-core/playwright');

  const axeResultAudit1: AxeResultsByType = {
    violations: [
      {
        id: 'rule-a',
        impact: 'serious',
        description: 'Rule A description',
        help: 'Rule A help',
        helpUrl: 'https://example.com/rule-a',
        tags: ['wcag2a'],
        nodes: [
          {
            html: '<div>a</div>',
            target: ['div'],
            failureSummary: 'Failure A',
          },
        ],
      },
    ],
    passes: [],
    incomplete: [],
  };

  const axeResultAudit2: AxeResultsByType = {
    violations: [
      {
        id: 'rule-b',
        impact: 'moderate',
        description: 'Rule B description',
        help: 'Rule B help',
        helpUrl: 'https://example.com/rule-b',
        tags: ['wcag2aa'],
        nodes: [
          {
            html: '<span>b</span>',
            target: ['span'],
            failureSummary: 'Failure B',
          },
        ],
      },
    ],
    passes: [],
    incomplete: [],
  };

  beforeAll(async () => {
    // Usa una copia de desarrollo si existe y, si no, crea el esquema desde migraciones.
    await prepareE2eDatabase();

    prisma = new PrismaClient();

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
    httpServer = app.getHttpServer() as SuperTestApp;
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  beforeEach(async () => {
    const { axeQueue, analyzeMock } = axeMock.__mock;
    axeQueue.length = 0;
    analyzeMock.mockClear();

    const { mockPage, mockContext, mockBrowser } = playwrightMock.__mock;
    mockPage.goto.mockClear();
    mockContext.newPage.mockClear();
    mockBrowser.newContext.mockClear();

    // Limpia tablas para que cada test sea independiente
    await prisma?.occurrence.deleteMany();
    await prisma?.rule.deleteMany();
    await prisma?.audit.deleteMany();
    await prisma?.website.deleteMany();
  });

  it('POST /audits crea y persiste una auditoría', async () => {
    const { axeQueue } = axeMock.__mock;
    axeQueue.push(axeResultAudit1);

    const res = await request(httpServer)
      .post('/audits')
      .send({ url: 'https://example.com' })
      .expect(201);

    expect(res.body.url).toBe('https://example.com/');
    expect(res.body.rules).toHaveLength(1);
    expect(res.body.occurrences).toHaveLength(1);

    const audits = await prisma?.audit.findMany();
    expect(audits).toHaveLength(1);
  });

  it('GET /audits lista las auditorías', async () => {
    const { axeQueue } = axeMock.__mock;
    axeQueue.push(axeResultAudit1, axeResultAudit2);
    await request(httpServer)
      .post('/audits')
      .send({ url: 'https://example.com' })
      .expect(201);
    await request(httpServer)
      .post('/audits')
      .send({ url: 'https://example.com' })
      .expect(201);

    const res = await request(httpServer).get('/audits').expect(200);
    expect(res.body.total).toBe(2);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0].website).toBe('https://example.com/');
  });

  it('GET /audits/:id devuelve detalle de auditoría', async () => {
    const { axeQueue } = axeMock.__mock;
    axeQueue.push(axeResultAudit1);
    await request(httpServer)
      .post('/audits')
      .send({ url: 'https://example.com' })
      .expect(201);

    const list = await request(httpServer).get('/audits').expect(200);
    const id = list.body.items[0].id;

    const detail = await request(httpServer).get(`/audits/${id}`).expect(200);

    expect(detail.body.rules).toHaveLength(1);
    expect(detail.body.occurrences).toHaveLength(1);
    expect(detail.body.url).toBe('https://example.com/');
  });

  it('GET /audits/runtime devuelve estado operativo', async () => {
    const runtime = await request(httpServer)
      .get('/audits/runtime')
      .expect(200);

    expect(runtime.body).toHaveProperty('activeAudits');
    expect(runtime.body).toHaveProperty('queued');
    expect(runtime.body).toHaveProperty('limits');
  });

  it('GET /audits/compare devuelve nuevas y resueltas', async () => {
    // Primera auditoría con rule-a
    const { axeQueue } = axeMock.__mock;
    axeQueue.push(axeResultAudit1);
    await request(httpServer)
      .post('/audits')
      .send({ url: 'https://example.com' })
      .expect(201);

    // Segunda auditoría con rule-b (rule-a desaparece => resuelta)
    axeQueue.push(axeResultAudit2);
    await request(httpServer)
      .post('/audits')
      .send({ url: 'https://example.com' })
      .expect(201);

    const list = await request(httpServer).get('/audits').expect(200);
    const [newer, older] = list.body.items; // ordenado desc por timestamp

    const res = await request(httpServer)
      .get(`/audits/compare?old=${older.id}&new=${newer.id}`)
      .expect(200);

    expect(res.body.summary.newViolationRules).toBe(1);
    expect(res.body.summary.resolvedViolationRules).toBe(1);
    expect(res.body.newViolations[0].ruleId).toBe('rule-b');
    expect(res.body.resolvedViolations[0].ruleId).toBe('rule-a');
  });
});
