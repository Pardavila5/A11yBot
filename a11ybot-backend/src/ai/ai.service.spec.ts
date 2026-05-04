import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AiService } from './ai.service';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

type TraceStoreItem = {
  id: number;
  createdAt?: Date;
  operation?: string;
  source?: string;
  auditId?: number | null;
  compareOldAudit?: number | null;
  compareNewAudit?: number | null;
  [key: string]: unknown;
};

type TraceWhere = {
  operation?: string;
  source?: string;
  auditId?: number | null;
  compareOldAudit?: number | null;
  compareNewAudit?: number | null;
};

type TraceFindManyArgs = {
  where?: TraceWhere;
  take?: number;
  orderBy?: {
    createdAt?: 'asc' | 'desc';
  };
};

type OpenAiAttemptMock = {
  attempted: boolean;
  status: string | null;
  responseModel: string | null;
};

type RequestOpenAiJsonMock = (
  systemPrompt: string,
  userPayload: unknown,
  attempt: OpenAiAttemptMock,
) => Promise<Record<string, unknown> | null>;

type AiServicePrivate = AiService & {
  requestOpenAiJson: RequestOpenAiJsonMock;
};

describe('AiService', () => {
  let service: AiService;
  let traceStore: TraceStoreItem[];
  let auditServiceMock: { compareAudits: jest.Mock };
  let prisma: {
    audit: { findUnique: jest.Mock };
    aiTrace: {
      create: jest.Mock<Promise<TraceStoreItem>, [{ data: TraceStoreItem }]>;
      count: jest.Mock<Promise<number>, [{ where?: TraceWhere }]>;
      findMany: jest.Mock<Promise<TraceStoreItem[]>, [TraceFindManyArgs]>;
    };
  };

  const auditFixture = {
    id: 1,
    timestamp: new Date('2026-04-10T19:00:43.000Z'),
    status: 'completed',
    website: { url: 'https://example.com' },
    rules: [
      {
        id: 101,
        ruleId: 'image-alt',
        impact: 'serious',
        type: 'violations',
        description: 'Images must have alternate text',
        help: 'Ensure <img> has alt text',
        helpUrl: 'https://example.com/image-alt',
        wcag: '["wcag111"]',
      },
      {
        id: 102,
        ruleId: 'html-has-lang',
        impact: 'serious',
        type: 'violations',
        description: 'HTML element must have a lang attribute',
        help: 'Ensure html has lang attribute',
        helpUrl: 'https://example.com/html-has-lang',
        wcag: '["wcag311"]',
      },
      {
        id: 103,
        ruleId: 'landmark-one-main',
        impact: null,
        type: 'passes',
        description: 'Page has one main landmark',
        help: 'Ensure the document has a main landmark',
        helpUrl: 'https://example.com/landmark-one-main',
        wcag: '["wcag131"]',
      },
      {
        id: 104,
        ruleId: 'color-contrast',
        impact: null,
        type: 'passes',
        description: 'Elements meet minimum contrast',
        help: 'Ensure the contrast meets thresholds',
        helpUrl: 'https://example.com/color-contrast',
        wcag: '["wcag143"]',
      },
      {
        id: 105,
        ruleId: 'color-contrast',
        impact: null,
        type: 'incomplete',
        description: 'Background image prevented automatic contrast check',
        help: 'Ensure the contrast meets thresholds',
        helpUrl: 'https://example.com/color-contrast',
        wcag: '["wcag143"]',
      },
    ],
    occurrences: [
      { ruleRef: 101 },
      { ruleRef: 101 },
      { ruleRef: 102 },
      { ruleRef: 104 },
      { ruleRef: 105 },
      { ruleRef: 105 },
    ],
  };

  beforeEach(async () => {
    traceStore = [];
    auditServiceMock = {
      compareAudits: jest.fn(),
    };
    prisma = {
      audit: {
        findUnique: jest.fn().mockResolvedValue(auditFixture),
      },
      aiTrace: {
        create: jest.fn().mockImplementation(async ({ data }) => {
          const created: TraceStoreItem = {
            id: traceStore.length + 1,
            createdAt: new Date(),
            ...data,
          };
          traceStore.push(created);
          return created;
        }),
        count: jest.fn().mockImplementation(async ({ where }) => {
          return traceStore.filter((item) => {
            if (!where) return true;
            if (where.operation && item.operation !== where.operation)
              return false;
            if (where.source && item.source !== where.source) return false;
            if (
              Object.prototype.hasOwnProperty.call(where, 'auditId') &&
              item.auditId !== where.auditId
            ) {
              return false;
            }
            return true;
          }).length;
        }),
        findMany: jest
          .fn()
          .mockImplementation(async ({ where, take, orderBy }) => {
            const items = traceStore
              .filter((item) => {
                if (!where) return true;
                if (where.operation && item.operation !== where.operation)
                  return false;
                if (where.source && item.source !== where.source) return false;
                if (
                  Object.prototype.hasOwnProperty.call(where, 'auditId') &&
                  item.auditId !== where.auditId
                ) {
                  return false;
                }
                if (
                  Object.prototype.hasOwnProperty.call(
                    where,
                    'compareOldAudit',
                  ) &&
                  item.compareOldAudit !== where.compareOldAudit
                ) {
                  return false;
                }
                if (
                  Object.prototype.hasOwnProperty.call(
                    where,
                    'compareNewAudit',
                  ) &&
                  item.compareNewAudit !== where.compareNewAudit
                ) {
                  return false;
                }
                return true;
              })
              .sort((a, b) => b.id - a.id);
            if (orderBy?.createdAt === 'desc') {
              items.sort((a, b) => b.id - a.id);
            }
            return typeof take === 'number' ? items.slice(0, take) : items;
          }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
        {
          provide: AuditService,
          useValue: auditServiceMock,
        },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              if (key === 'OPENAI_MODEL') return 'gpt-4o-mini';
              return undefined;
            },
          },
        },
      ],
    }).compile();

    service = module.get<AiService>(AiService);
  });

  const mockOpenAiJson = (implementation: RequestOpenAiJsonMock) =>
    (
      jest.spyOn(
        service as unknown as AiServicePrivate,
        'requestOpenAiJson',
      ) as unknown as jest.MockedFunction<RequestOpenAiJsonMock>
    ).mockImplementation(implementation);

  const getCreatedTraceData = (index = 0): TraceStoreItem =>
    prisma.aiTrace.create.mock.calls[index][0].data;

  it('uses OpenAI output when payload is valid through aliases', async () => {
    mockOpenAiJson(async (_prompt, _input, attempt) => {
      attempt.attempted = true;
      attempt.status = 'success';
      attempt.responseModel = 'gpt-4o-mini-2024-07-18';
      return {
        executive_summary: 'Resumen ejecutivo correcto',
        technical_summary: 'Resumen tecnico correcto',
        recommendations: [
          {
            title: 'Corregir image-alt',
            reason: 'Falta texto alternativo',
            actions: ['Anadir alt descriptivo'],
            priority: 'high',
          },
        ],
        _model: 'gpt-4o-mini-2024-07-18',
      };
    });

    const result = await service.getAuditSummary(1, { forceHeuristic: false });

    expect(result.source).toBe('openai');
    expect(result.executiveSummary).toBe('Resumen ejecutivo correcto');
    expect(result.technicalSummary).toBe('Resumen tecnico correcto');
    expect(result.resolution.status).toBe('success');
    expect(result.resolution.usedFallback).toBe(false);
    expect(result.recommendations).toHaveLength(1);
  });

  it('falls back to heuristic and records invalid_payload when OpenAI output is incomplete', async () => {
    mockOpenAiJson(async (_prompt, _input, attempt) => {
      attempt.attempted = true;
      attempt.status = 'success';
      attempt.responseModel = 'gpt-4o-mini-2024-07-18';
      return {
        summary: {
          executive: 'Solo llega el resumen ejecutivo',
        },
        _model: 'gpt-4o-mini-2024-07-18',
      };
    });

    const result = await service.getAuditSummary(1, { forceHeuristic: false });

    expect(result.source).toBe('heuristic');
    expect(result.resolution.status).toBe('invalid_payload');
    expect(result.resolution.usedFallback).toBe(true);
    expect(result.resolution.reason).toContain('technicalSummary=false');

    expect(prisma.aiTrace.create).toHaveBeenCalled();
    const responseMeta = getCreatedTraceData(0).responseMeta as {
      openAiAttempt: { status: string };
    };
    expect(responseMeta.openAiAttempt.status).toBe('invalid_payload');
    expect(getCreatedTraceData(0).success).toBe(false);
  });

  it('reuses an existing assisted audit summary instead of calling OpenAI again', async () => {
    const requestOpenAiJson = mockOpenAiJson(
      async (_prompt, _input, attempt) => {
        attempt.attempted = true;
        attempt.status = 'success';
        attempt.responseModel = 'gpt-4o-mini-2024-07-18';
        return {
          executiveSummary: 'Resumen cacheable',
          technicalSummary: 'Detalle cacheable',
          recommendations: [
            {
              title: 'Corregir image-alt',
              reason: 'Falta texto alternativo',
              actions: ['Añadir alt descriptivo'],
              priority: 'high',
            },
          ],
          _model: 'gpt-4o-mini-2024-07-18',
        };
      },
    );

    const first = await service.getAuditSummary(1, { forceHeuristic: false });
    const second = await service.getAuditSummary(1, { forceHeuristic: false });

    expect(requestOpenAiJson).toHaveBeenCalledTimes(1);
    expect(second.traceId).toBe(first.traceId);
    expect(second.executiveSummary).toBe(first.executiveSummary);
    expect(prisma.aiTrace.create).toHaveBeenCalledTimes(1);
  });

  it('builds a pass-oriented explanation instead of a remediation message for passed rules', async () => {
    const result = await service.explainRuleInAudit(1, 'landmark-one-main', {
      forceHeuristic: true,
      maxOccurrences: 3,
    });

    expect(result.rule.type).toBe('passes');
    expect(result.explanation.summary.toLowerCase()).toContain(
      'validado correctamente',
    );
    expect(result.explanation.summary.toLowerCase()).not.toContain(
      'corrección',
    );
    expect(result.explanation.whyItMatters.toLowerCase()).toContain('preserv');
  });

  it('resolves duplicated ruleIds using the requested ruleType for incomplete explanations', async () => {
    const result = await service.explainRuleInAudit(1, 'color-contrast', {
      ruleType: 'incomplete',
      forceHeuristic: true,
      maxOccurrences: 3,
    });

    expect(result.rule.type).toBe('incomplete');
    expect(result.rule.occurrences).toBe(2);
    expect(result.explanation.summary.toLowerCase()).toContain(
      'revisión manual',
    );
    expect(result.explanation.whyItMatters.toLowerCase()).toContain(
      'no implica ni fallo ni cumplimiento',
    );
  });

  it('aggregates trace statistics by operation, source and attempt status', async () => {
    traceStore.push(
      {
        id: 1,
        operation: 'audit_summary',
        source: 'heuristic',
        model: null,
        latencyMs: 12,
        createdAt: new Date(),
        responseMeta: {
          openAiAttempt: {
            status: 'not_configured',
          },
        },
      },
      {
        id: 2,
        operation: 'compare_summary',
        source: 'openai',
        model: 'gpt-4o-mini',
        latencyMs: 240,
        createdAt: new Date(),
        responseMeta: {
          openAiAttempt: {
            status: 'success',
          },
        },
      },
    );

    const stats = await service.getTraceStats({});

    expect(stats.window.total).toBe(2);
    expect(stats.usage.byOperation).toEqual({
      audit_summary: 1,
      compare_summary: 1,
    });
    expect(stats.usage.bySource).toEqual({
      heuristic: 1,
      openai: 1,
    });
    expect(stats.usage.byModel).toEqual({
      'gpt-4o-mini': 1,
    });
    expect(stats.usage.fallbackRate).toBe(0.5);
    expect(stats.latency.avgMs).toBe(126);
    expect(stats.attempts.byStatus).toEqual({
      not_configured: 1,
      success: 1,
    });
  });

  it('returns the real filtered trace total instead of the limited slice size', async () => {
    traceStore.push(
      {
        id: 1,
        operation: 'audit_summary',
        source: 'heuristic',
        model: null,
        auditId: 1,
        latencyMs: 10,
        success: true,
        errorMessage: null,
        createdAt: new Date(),
      },
      {
        id: 2,
        operation: 'audit_summary',
        source: 'heuristic',
        model: null,
        auditId: 1,
        latencyMs: 20,
        success: true,
        errorMessage: null,
        createdAt: new Date(),
      },
      {
        id: 3,
        operation: 'audit_summary',
        source: 'heuristic',
        model: null,
        auditId: 1,
        latencyMs: 30,
        success: true,
        errorMessage: null,
        createdAt: new Date(),
      },
    );

    const result = await service.listTraces({ limit: 2, auditId: 1 });

    expect(result.total).toBe(3);
    expect(result.items).toHaveLength(2);
  });

  it('builds comparison summaries from compareAudits and persists the assisted result', async () => {
    auditServiceMock.compareAudits.mockResolvedValue({
      audits: {
        old: {
          id: 1,
          url: 'https://example.com/old',
          timestamp: new Date('2026-04-10T10:00:00.000Z'),
        },
        new: {
          id: 2,
          url: 'https://example.com/new',
          timestamp: new Date('2026-04-11T10:00:00.000Z'),
        },
      },
      summary: {
        totalViolationRulesOld: 3,
        totalViolationRulesNew: 2,
        totalOccurrencesOld: 7,
        totalOccurrencesNew: 4,
        deltaViolationRules: -1,
        newViolationRules: 1,
        resolvedViolationRules: 2,
        persistentViolationRules: 1,
      },
    });

    mockOpenAiJson(async (_prompt, _input, attempt) => {
      attempt.attempted = true;
      attempt.status = 'success';
      attempt.responseModel = 'gpt-4o-mini-2024-07-18';
      return {
        executiveSummary: 'Comparativa correcta',
        technicalSummary:
          'Hay mejoras netas, pero queda una regla persistente.',
        recommendations: [
          {
            title: 'Cerrar persistentes',
            reason: 'Todavia queda una regla abierta',
            actions: ['Resolver la regla persistente', 'Reauditar'],
            priority: 'medium',
          },
        ],
        _model: 'gpt-4o-mini-2024-07-18',
      };
    });

    const result = await service.getComparisonSummary(1, 2, {
      forceHeuristic: false,
    });

    expect(auditServiceMock.compareAudits).toHaveBeenCalledWith(1, 2);
    expect(result.source).toBe('openai');
    expect(result.executiveSummary).toBe('Comparativa correcta');
    expect(result.summary.resolvedViolationRules).toBe(2);
    expect(prisma.aiTrace.create).toHaveBeenCalled();
    expect(
      getCreatedTraceData(prisma.aiTrace.create.mock.calls.length - 1)
        .operation,
    ).toBe('compare_summary');
  });
});
