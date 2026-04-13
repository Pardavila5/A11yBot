import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AiService } from './ai.service';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AiService', () => {
  let service: AiService;
  let traceStore: Array<{ id: number; [key: string]: any }>;
  let prisma: {
    audit: { findUnique: jest.Mock };
    aiTrace: { create: jest.Mock; findMany: jest.Mock };
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
    prisma = {
      audit: {
        findUnique: jest.fn().mockResolvedValue(auditFixture),
      },
      aiTrace: {
        create: jest.fn().mockImplementation(async ({ data }) => {
          const created = { id: traceStore.length + 1, createdAt: new Date(), ...data };
          traceStore.push(created);
          return created;
        }),
        findMany: jest.fn().mockImplementation(async ({ where }) => {
          return traceStore
            .filter((item) => {
              if (!where) return true;
              if (where.operation && item.operation !== where.operation) return false;
              if (
                Object.prototype.hasOwnProperty.call(where, 'auditId') &&
                item.auditId !== where.auditId
              ) {
                return false;
              }
              if (
                Object.prototype.hasOwnProperty.call(where, 'compareOldAudit') &&
                item.compareOldAudit !== where.compareOldAudit
              ) {
                return false;
              }
              if (
                Object.prototype.hasOwnProperty.call(where, 'compareNewAudit') &&
                item.compareNewAudit !== where.compareNewAudit
              ) {
                return false;
              }
              return true;
            })
            .sort((a, b) => b.id - a.id);
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
          useValue: {
            compareAudits: jest.fn(),
          },
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

  it('uses OpenAI output when payload is valid through aliases', async () => {
    jest
      .spyOn(service as never, 'requestOpenAiJson' as never)
      .mockImplementation(async (_prompt, _input, attempt) => {
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
    jest
      .spyOn(service as never, 'requestOpenAiJson' as never)
      .mockImplementation(async (_prompt, _input, attempt) => {
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
    expect(
      prisma.aiTrace.create.mock.calls[0][0].data.responseMeta.openAiAttempt.status,
    ).toBe('invalid_payload');
  });

  it('reuses an existing assisted audit summary instead of calling OpenAI again', async () => {
    const requestOpenAiJson = jest
      .spyOn(service as never, 'requestOpenAiJson' as never)
      .mockImplementation(async (_prompt, _input, attempt) => {
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
      });

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
    expect(result.explanation.summary.toLowerCase()).toContain('validado correctamente');
    expect(result.explanation.summary.toLowerCase()).not.toContain('corrección');
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
    expect(result.explanation.summary.toLowerCase()).toContain('revisión manual');
    expect(result.explanation.whyItMatters.toLowerCase()).toContain('no implica ni fallo ni cumplimiento');
  });
});
