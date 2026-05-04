import {
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AxeResultsByType } from '../common/interfaces/axe-result.interface';
import { AuditService } from './audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { LookupAddress, promises as dns } from 'node:dns';

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
  const analyzeMock = jest.fn();
  const mockBuilder = jest.fn().mockImplementation(() => ({
    analyze: analyzeMock,
  }));

  return {
    AxeBuilder: mockBuilder,
    __mock: {
      analyzeMock,
      mockBuilder,
    },
  };
});

type PrismaMock = {
  audit: {
    create: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
  };
  $transaction: jest.Mock;
};

type DnsLookupAll = (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<LookupAddress[]>;

function buildComparisonAudit(input: {
  id: number;
  url: string;
  timestamp: string;
  rules: Array<{
    id: number;
    ruleId: string;
    impact: string | null;
    description: string;
    help: string;
    helpUrl: string;
    wcag: string;
    type?: string;
  }>;
  occurrences: Array<{
    id: number;
    ruleRef: number;
    htmlSnippet: string;
    target: string;
    failureSummary: string | null;
  }>;
}) {
  const rules = input.rules.map((rule) => ({
    ...rule,
    type: rule.type ?? 'violations',
  }));

  return {
    id: input.id,
    timestamp: new Date(input.timestamp),
    website: { url: input.url },
    rules,
    occurrences: input.occurrences.map((occurrence) => ({
      ...occurrence,
      rule: rules.find((rule) => rule.id === occurrence.ruleRef) ?? rules[0],
    })),
  };
}

describe('AuditService', () => {
  let service: AuditService;
  let prisma: PrismaMock;
  let loggerWarnSpy: jest.SpyInstance;

  const playwrightMock = jest.requireMock('playwright');
  const axeMock = jest.requireMock('@axe-core/playwright');

  const mockDnsLookup = () =>
    jest.spyOn(dns, 'lookup') as unknown as jest.MockedFunction<DnsLookupAll>;

  const privateApi = () =>
    service as unknown as {
      acquireSlot(host: string): Promise<void>;
      createRunningAudit(url: string): Promise<{ auditId: number }>;
      executeAuditWithRetries(
        page: { goto: jest.Mock },
        url: string,
      ): Promise<{ axeResults: AxeResultsByType; attemptsUsed: number }>;
      getErrorMessage(error: unknown): string;
      isPrivateOrReservedIp(value: string): boolean;
      markAuditFailed(auditId: number, message: string): Promise<void>;
      normalize(results: AxeResultsByType): {
        rules: Array<{ ruleId: string; type: string; wcag: string[] }>;
        occurrences: Array<{ ruleId: string; type: string }>;
      };
      parseStoredStringArray(value: string | null | undefined): string[];
      releaseSlot(host: string): void;
      saveAuditResults(
        auditId: number,
        timestamp: Date,
        rawResults: AxeResultsByType,
        rules: Array<{
          ruleId: string;
          impact: string | null;
          description: string;
          help: string;
          helpUrl: string;
          wcag: string[];
          type: 'violations' | 'passes' | 'incomplete';
        }>,
        occurrences: Array<{
          ruleId: string;
          type: 'violations' | 'passes' | 'incomplete';
          htmlSnippet: string;
          target: string[];
          failureSummary: string | null;
        }>,
      ): Promise<void>;
      sleep(ms: number): Promise<void>;
      validateAndNormalizeUrl(rawUrl: string): Promise<URL>;
    };

  const configValues = new Map<string, string>([
    ['AUDIT_TIMEOUT_MS', '12000'],
    ['AUDIT_MAX_RETRIES', '2'],
    ['AUDIT_RETRY_DELAY_MS', '750'],
    ['AUDIT_MAX_CONCURRENT', '4'],
    ['AUDIT_MAX_CONCURRENT_PER_HOST', '2'],
    ['ALLOW_PRIVATE_TARGETS', 'false'],
  ]);

  beforeEach(() => {
    prisma = {
      audit: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    service = new AuditService(
      prisma as unknown as PrismaService,
      {
        get: (key: string) => configValues.get(key),
      } as ConfigService,
    );

    loggerWarnSpy = jest
      .spyOn(
        (service as unknown as { logger: { warn: (message: string) => void } })
          .logger,
        'warn',
      )
      .mockImplementation(() => undefined);

    axeMock.__mock.analyzeMock.mockReset();
    axeMock.__mock.mockBuilder.mockClear();
    playwrightMock.chromium.launch.mockClear();
    playwrightMock.__mock.mockPage.goto.mockClear();
    playwrightMock.__mock.mockPage.close.mockClear();
    playwrightMock.__mock.mockContext.newPage.mockClear();
    playwrightMock.__mock.mockContext.close.mockClear();
    playwrightMock.__mock.mockBrowser.newContext.mockClear();
    playwrightMock.__mock.mockBrowser.close.mockClear();
  });

  afterEach(() => {
    loggerWarnSpy.mockRestore();
    jest.restoreAllMocks();
  });

  it('reports configured runtime limits and timeouts', () => {
    const runtime = service.getAuditRuntimeStats();

    expect(runtime).toEqual({
      activeAudits: 0,
      activeByHost: {},
      queued: 0,
      limits: {
        global: 4,
        perHost: 2,
      },
      timeoutMs: 12000,
      retries: 2,
      retryDelayMs: 750,
      allowPrivateTargets: false,
    });
  });

  it('compares audits and separates new, resolved and persistent violations', async () => {
    prisma.audit.findUnique
      .mockResolvedValueOnce(
        buildComparisonAudit({
          id: 1,
          url: 'https://example.com/old',
          timestamp: '2026-04-10T10:00:00.000Z',
          rules: [
            {
              id: 101,
              ruleId: 'image-alt',
              impact: 'serious',
              description: 'Images need alt text',
              help: 'Add alt',
              helpUrl: 'https://example.com/image-alt',
              wcag: '["wcag111"]',
            },
            {
              id: 102,
              ruleId: 'label',
              impact: 'moderate',
              description: 'Inputs need labels',
              help: 'Add labels',
              helpUrl: 'https://example.com/label',
              wcag: '["wcag131"]',
            },
          ],
          occurrences: [
            {
              id: 1001,
              ruleRef: 101,
              htmlSnippet: '<img>',
              target: '["img.hero"]',
              failureSummary: 'Missing alt',
            },
            {
              id: 1002,
              ruleRef: 102,
              htmlSnippet: '<input>',
              target: '["#email"]',
              failureSummary: 'Missing label',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        buildComparisonAudit({
          id: 2,
          url: 'https://example.com/new',
          timestamp: '2026-04-11T10:00:00.000Z',
          rules: [
            {
              id: 201,
              ruleId: 'label',
              impact: 'moderate',
              description: 'Inputs need labels',
              help: 'Add labels',
              helpUrl: 'https://example.com/label',
              wcag: '["wcag131"]',
            },
            {
              id: 202,
              ruleId: 'color-contrast',
              impact: 'serious',
              description: 'Contrast is too low',
              help: 'Increase contrast',
              helpUrl: 'https://example.com/color-contrast',
              wcag: '["wcag143"]',
            },
          ],
          occurrences: [
            {
              id: 2001,
              ruleRef: 201,
              htmlSnippet: '<input>',
              target: '["#email"]',
              failureSummary: 'Missing label',
            },
            {
              id: 2002,
              ruleRef: 202,
              htmlSnippet: '<button>',
              target: '[".cta"]',
              failureSummary: 'Low contrast',
            },
            {
              id: 2003,
              ruleRef: 202,
              htmlSnippet: '<a>',
              target: '[".footer-link"]',
              failureSummary: 'Low contrast',
            },
          ],
        }),
      );

    const result = await service.compareAudits(1, 2);

    expect(result.summary).toEqual({
      totalViolationRulesOld: 2,
      totalViolationRulesNew: 2,
      totalOccurrencesOld: 2,
      totalOccurrencesNew: 3,
      deltaViolationRules: 0,
      newViolationRules: 1,
      resolvedViolationRules: 1,
      persistentViolationRules: 1,
    });
    expect(result.newViolations.map((item) => item.ruleId)).toEqual([
      'color-contrast',
    ]);
    expect(result.resolvedViolations.map((item) => item.ruleId)).toEqual([
      'image-alt',
    ]);
    expect(result.persistentViolations.map((item) => item.ruleId)).toEqual([
      'label',
    ]);
    expect(result.newViolations[0].occurrences).toHaveLength(2);
  });

  it('rejects when the new audit does not exist', async () => {
    prisma.audit.findUnique
      .mockResolvedValueOnce(
        buildComparisonAudit({
          id: 1,
          url: 'https://example.com/a',
          timestamp: '2026-04-10T10:00:00.000Z',
          rules: [],
          occurrences: [],
        }),
      )
      .mockResolvedValueOnce(null);

    await expect(service.compareAudits(1, 2)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects comparisons between different hosts', async () => {
    prisma.audit.findUnique
      .mockResolvedValueOnce(
        buildComparisonAudit({
          id: 1,
          url: 'https://example.com/a',
          timestamp: '2026-04-10T10:00:00.000Z',
          rules: [],
          occurrences: [],
        }),
      )
      .mockResolvedValueOnce(
        buildComparisonAudit({
          id: 2,
          url: 'https://other.example.org/b',
          timestamp: '2026-04-11T10:00:00.000Z',
          rules: [],
          occurrences: [],
        }),
      );

    await expect(service.compareAudits(1, 2)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects missing audits before comparing', async () => {
    prisma.audit.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(
      buildComparisonAudit({
        id: 2,
        url: 'https://example.com/b',
        timestamp: '2026-04-11T10:00:00.000Z',
        rules: [],
        occurrences: [],
      }),
    );

    await expect(service.compareAudits(1, 2)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('validates public URLs and blocks invalid or private targets', async () => {
    mockDnsLookup().mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
    ]);

    await expect(
      privateApi().validateAndNormalizeUrl('https://example.com'),
    ).resolves.toHaveProperty('host', 'example.com');

    await expect(
      privateApi().validateAndNormalizeUrl('notaurl'),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      privateApi().validateAndNormalizeUrl('ftp://example.com'),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      privateApi().validateAndNormalizeUrl('https://user:pass@example.com'),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      privateApi().validateAndNormalizeUrl('http://localhost:3000'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects URLs when DNS resolution fails, is empty or points to private IPs', async () => {
    mockDnsLookup().mockRejectedValueOnce(new Error('dns fail'));
    await expect(
      privateApi().validateAndNormalizeUrl('https://example.com'),
    ).rejects.toBeInstanceOf(BadRequestException);

    mockDnsLookup().mockResolvedValueOnce([]);
    await expect(
      privateApi().validateAndNormalizeUrl('https://example.com'),
    ).rejects.toBeInstanceOf(BadRequestException);

    mockDnsLookup().mockResolvedValueOnce([
      { address: '192.168.1.12', family: 4 },
    ]);
    await expect(
      privateApi().validateAndNormalizeUrl('https://example.com'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows private targets when the config explicitly enables them', async () => {
    const permissiveService = new AuditService(
      prisma as unknown as PrismaService,
      {
        get: (key: string) =>
          key === 'ALLOW_PRIVATE_TARGETS' ? 'true' : configValues.get(key),
      } as ConfigService,
    );

    await expect(
      (
        permissiveService as unknown as {
          validateAndNormalizeUrl(rawUrl: string): Promise<URL>;
        }
      ).validateAndNormalizeUrl('http://localhost:3000'),
    ).resolves.toHaveProperty('host', 'localhost:3000');
  });

  it('classifies reserved IPv4 and IPv6 addresses correctly', () => {
    expect(privateApi().isPrivateOrReservedIp('93.184.216.34')).toBe(false);
    expect(privateApi().isPrivateOrReservedIp('10.0.0.1')).toBe(true);
    expect(privateApi().isPrivateOrReservedIp('127.0.0.1')).toBe(true);
    expect(privateApi().isPrivateOrReservedIp('::1')).toBe(true);
    expect(privateApi().isPrivateOrReservedIp('2001:4860:4860::8888')).toBe(
      false,
    );
  });

  it('normalizes violations, passes and incomplete results preserving occurrences', () => {
    const normalized = privateApi().normalize({
      violations: [
        {
          id: 'image-alt',
          impact: 'serious',
          description: 'Alt text required',
          help: 'Add alt text',
          helpUrl: 'https://example.com/image-alt',
          tags: ['wcag111', 'best-practice'],
          nodes: [
            {
              html: '<img>',
              target: ['img.hero'],
              failureSummary: 'Missing alt',
            },
          ],
        },
      ],
      passes: [
        {
          id: 'image-alt',
          impact: null,
          description: 'Alt text present',
          help: 'Alt text exists',
          helpUrl: 'https://example.com/image-alt',
          tags: ['wcag111'],
          nodes: [
            {
              html: '<img alt="ok">',
              target: ['img.logo'],
            },
          ],
        },
      ],
      incomplete: [
        {
          id: 'color-contrast',
          impact: null,
          description: 'Manual review needed',
          help: 'Check contrast',
          helpUrl: 'https://example.com/color-contrast',
          tags: ['wcag143'],
          nodes: [
            {
              html: '<span>',
              target: ['.cta'],
              failureSummary: 'Background image prevented automatic check',
            },
          ],
        },
      ],
    });

    expect(normalized.rules).toHaveLength(3);
    expect(
      normalized.rules.map((item) => `${item.ruleId}:${item.type}`),
    ).toEqual([
      'image-alt:violations',
      'image-alt:passes',
      'color-contrast:incomplete',
    ]);
    expect(normalized.rules[0].wcag).toEqual(['wcag111']);
    expect(normalized.occurrences).toHaveLength(3);
    expect(normalized.occurrences[2]).toMatchObject({
      ruleId: 'color-contrast',
      type: 'incomplete',
    });
  });

  it('creates running audits, saves results and marks failures with bounded notes', async () => {
    const tx = {
      website: {
        upsert: jest.fn().mockResolvedValue({ id: 3 }),
      },
      audit: {
        create: jest.fn().mockResolvedValue({ id: 8 }),
        update: jest.fn().mockResolvedValue(undefined),
      },
      rule: {
        create: jest.fn().mockResolvedValueOnce({ id: 81 }),
      },
      occurrence: {
        create: jest.fn().mockResolvedValue(undefined),
      },
    };
    prisma.$transaction.mockImplementation(async (callback) => callback(tx));

    await expect(
      privateApi().createRunningAudit('https://example.com/'),
    ).resolves.toEqual({ auditId: 8 });
    expect(tx.website.upsert).toHaveBeenCalledWith({
      where: { url: 'https://example.com/' },
      update: {},
      create: { url: 'https://example.com/' },
    });

    await privateApi().saveAuditResults(
      8,
      new Date('2026-04-13T10:00:00.000Z'),
      { violations: [], passes: [], incomplete: [] },
      [
        {
          ruleId: 'image-alt',
          impact: 'serious',
          description: 'Alt text required',
          help: 'Add alt',
          helpUrl: 'https://example.com/image-alt',
          wcag: ['wcag111'],
          type: 'violations',
        },
      ],
      [
        {
          ruleId: 'image-alt',
          type: 'violations',
          htmlSnippet: '<img>',
          target: ['img.hero'],
          failureSummary: 'Missing alt',
        },
        {
          ruleId: 'missing-rule',
          type: 'violations',
          htmlSnippet: '<button>',
          target: ['.cta'],
          failureSummary: 'Unknown',
        },
      ],
    );

    expect(tx.audit.update).toHaveBeenCalledWith({
      where: { id: 8 },
      data: {
        rawJson: { violations: [], passes: [], incomplete: [] },
        timestamp: new Date('2026-04-13T10:00:00.000Z'),
        status: 'completed',
        notes: null,
      },
    });
    expect(tx.rule.create).toHaveBeenCalledTimes(1);
    expect(tx.occurrence.create).toHaveBeenCalledTimes(1);
    expect(loggerWarnSpy).toHaveBeenCalledWith(
      'audit.save.missing_rule ruleId=missing-rule type=violations',
    );

    await privateApi().markAuditFailed(8, 'x'.repeat(600));
    expect(prisma.audit.update).toHaveBeenCalledWith({
      where: { id: 8 },
      data: {
        status: 'failed',
        notes: 'x'.repeat(500),
      },
    });
  });

  it('retries transient audit errors and stops on non-retryable ones', async () => {
    jest
      .spyOn(privateApi(), 'sleep')
      .mockImplementation(() => Promise.resolve());
    axeMock.__mock.analyzeMock.mockResolvedValue({
      violations: [],
      passes: [],
      incomplete: [],
    });

    const page = {
      goto: jest
        .fn()
        .mockRejectedValueOnce(new Error('Timeout while loading'))
        .mockResolvedValueOnce(undefined),
    };

    const retried = await privateApi().executeAuditWithRetries(
      page,
      'https://example.com/',
    );

    expect(retried.attemptsUsed).toBe(2);
    expect(page.goto).toHaveBeenCalledTimes(2);

    page.goto = jest
      .fn()
      .mockRejectedValue(new Error('Unexpected parser error'));
    await expect(
      privateApi().executeAuditWithRetries(page, 'https://example.com/'),
    ).rejects.toThrow('Unexpected parser error');
    expect(page.goto).toHaveBeenCalledTimes(1);
  });

  it('queues audits per host and releases them in FIFO order when a slot frees up', async () => {
    await privateApi().acquireSlot('example.com');
    await privateApi().acquireSlot('example.com');

    let released = false;
    const waiting = privateApi()
      .acquireSlot('example.com')
      .then(() => {
        released = true;
      });

    await Promise.resolve();
    expect(service.getAuditRuntimeStats()).toMatchObject({
      activeAudits: 2,
      queued: 1,
      activeByHost: { 'example.com': 2 },
    });

    privateApi().releaseSlot('example.com');
    await waiting;

    expect(released).toBe(true);
    expect(service.getAuditRuntimeStats()).toMatchObject({
      activeAudits: 2,
      queued: 0,
      activeByHost: { 'example.com': 2 },
    });
  });

  it('runs a full audit flow and translates runtime failures to user-facing HTTP errors', async () => {
    jest
      .spyOn(privateApi(), 'validateAndNormalizeUrl')
      .mockResolvedValue(new URL('https://example.com/'));
    jest
      .spyOn(privateApi(), 'createRunningAudit')
      .mockResolvedValue({ auditId: 21 });
    jest.spyOn(privateApi(), 'saveAuditResults').mockResolvedValue(undefined);
    jest.spyOn(privateApi(), 'markAuditFailed').mockResolvedValue(undefined);
    jest.spyOn(privateApi(), 'sleep').mockResolvedValue(undefined);

    axeMock.__mock.analyzeMock.mockResolvedValue({
      violations: [
        {
          id: 'image-alt',
          impact: 'serious',
          description: 'Alt text required',
          help: 'Add alt',
          helpUrl: 'https://example.com/image-alt',
          tags: ['wcag111'],
          nodes: [
            {
              html: '<img>',
              target: ['img.hero'],
              failureSummary: 'Missing alt',
            },
          ],
        },
      ],
      passes: [],
      incomplete: [],
    });

    const result = await service.runAudit('https://example.com');

    expect(result.url).toBe('https://example.com/');
    expect(result.rules).toHaveLength(1);
    expect(result.occurrences).toHaveLength(1);
    expect(playwrightMock.chromium.launch).toHaveBeenCalledWith({
      headless: true,
    });
    expect(playwrightMock.__mock.mockBrowser.close).toHaveBeenCalledTimes(1);
    expect(playwrightMock.__mock.mockContext.close).toHaveBeenCalledTimes(1);
    expect(playwrightMock.__mock.mockPage.close).toHaveBeenCalledTimes(1);

    playwrightMock.__mock.mockPage.goto.mockReset();
    jest
      .spyOn(privateApi(), 'createRunningAudit')
      .mockResolvedValue({ auditId: 22 });
    playwrightMock.__mock.mockPage.goto.mockRejectedValue(
      new Error('Timeout while loading'),
    );
    await expect(
      service.runAudit('https://example.com'),
    ).rejects.toBeInstanceOf(BadRequestException);

    playwrightMock.__mock.mockPage.goto.mockReset();
    playwrightMock.__mock.mockPage.goto.mockRejectedValue(new Error('Boom'));
    await expect(
      service.runAudit('https://example.com'),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('parses stored arrays defensively and extracts safe error messages', () => {
    expect(privateApi().parseStoredStringArray('["a",1,true]')).toEqual([
      'a',
      '1',
      'true',
    ]);
    expect(privateApi().parseStoredStringArray('invalid-json')).toEqual([]);
    expect(privateApi().getErrorMessage(new Error('boom'))).toBe('boom');
    expect(privateApi().getErrorMessage('plain')).toBe('plain');
  });
});
