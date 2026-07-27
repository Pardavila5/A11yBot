import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { PrismaService } from '../prisma/prisma.service';

type PrismaTransactionMock = {
  aiTrace: { deleteMany: jest.Mock<Promise<void>, []> };
  occurrence: { deleteMany: jest.Mock<Promise<void>, []> };
  rule: { deleteMany: jest.Mock<Promise<void>, []> };
  audit: { deleteMany: jest.Mock<Promise<void>, []> };
  website: { deleteMany: jest.Mock<Promise<void>, []> };
  $executeRawUnsafe: jest.Mock<Promise<void>, [string]>;
};

type PrismaMock = {
  audit: {
    count: jest.Mock<Promise<number>, []>;
    findMany: jest.Mock<Promise<unknown[]>, [unknown]>;
    findUnique: jest.Mock<Promise<unknown>, [unknown]>;
    update: jest.Mock<Promise<unknown>, [unknown]>;
  };
  $transaction: jest.Mock<
    Promise<void>,
    [(tx: PrismaTransactionMock) => Promise<void>]
  >;
};

type AuditServiceMock = {
  compareAudits: jest.Mock<Promise<unknown>, [number, number]>;
  getAuditRuntimeStats: jest.Mock<Promise<unknown>, []>;
  runAudit: jest.Mock<Promise<unknown>, [string]>;
};

describe('AuditController', () => {
  let controller: AuditController;
  let prisma: PrismaMock;
  let tx: PrismaTransactionMock;
  let auditService: AuditServiceMock;

  beforeEach(() => {
    tx = {
      aiTrace: { deleteMany: jest.fn().mockResolvedValue(undefined) },
      occurrence: { deleteMany: jest.fn().mockResolvedValue(undefined) },
      rule: { deleteMany: jest.fn().mockResolvedValue(undefined) },
      audit: { deleteMany: jest.fn().mockResolvedValue(undefined) },
      website: { deleteMany: jest.fn().mockResolvedValue(undefined) },
      $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
    };

    prisma = {
      audit: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
      },
      $transaction: jest
        .fn<Promise<void>, [(tx: PrismaTransactionMock) => Promise<void>]>()
        .mockImplementation(async (callback) => callback(tx)),
    };

    auditService = {
      compareAudits: jest.fn(),
      getAuditRuntimeStats: jest.fn(),
      runAudit: jest.fn(),
    };

    controller = new AuditController(
      prisma as unknown as PrismaService,
      auditService as unknown as AuditService,
    );
  });

  it('maps list items with website, status and notes', async () => {
    prisma.audit.count.mockResolvedValue(1);
    prisma.audit.findMany.mockResolvedValue([
      {
        id: 7,
        website: { url: 'https://example.com/' },
        timestamp: new Date('2026-04-10T12:00:00.000Z'),
        status: 'completed',
        notes: 'Revisada',
        rules: [
          { type: 'violations' },
          { type: 'violations' },
          { type: 'passes' },
          { type: 'incomplete' },
        ],
      },
    ]);

    const result = await controller.getAllAudits({
      page: 2,
      pageSize: 10,
      order: 'asc',
    });

    expect(prisma.audit.findMany).toHaveBeenCalledWith({
      skip: 10,
      take: 10,
      where: {},
      include: { website: true, rules: { select: { type: true } } },
      orderBy: { timestamp: 'asc' },
    });
    expect(result).toEqual({
      total: 1,
      page: 2,
      pageSize: 10,
      items: [
        {
          id: 7,
          website: 'https://example.com/',
          timestamp: new Date('2026-04-10T12:00:00.000Z'),
          status: 'completed',
          notes: 'Revisada',
          counts: { violations: 2, passes: 1, incomplete: 1 },
        },
      ],
    });
  });

  it('applies status and search filters to count and list queries', async () => {
    prisma.audit.count.mockResolvedValue(0);
    prisma.audit.findMany.mockResolvedValue([]);

    await controller.getAllAudits({
      page: 1,
      pageSize: 5,
      order: 'desc',
      status: 'failed',
      search: 'example.com',
    });

    const where = {
      status: 'failed',
      website: {
        url: {
          contains: 'example.com',
        },
      },
    };

    expect(prisma.audit.count).toHaveBeenCalledWith({ where });
    expect(prisma.audit.findMany).toHaveBeenCalledWith({
      skip: 0,
      take: 5,
      where,
      include: { website: true, rules: { select: { type: true } } },
      orderBy: { timestamp: 'desc' },
    });
  });

  it('deletes traces first and resets SQLite sequences', async () => {
    const result = await controller.deleteAll();

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.aiTrace.deleteMany).toHaveBeenCalledTimes(1);
    expect(tx.occurrence.deleteMany).toHaveBeenCalledTimes(1);
    expect(tx.rule.deleteMany).toHaveBeenCalledTimes(1);
    expect(tx.audit.deleteMany).toHaveBeenCalledTimes(1);
    expect(tx.website.deleteMany).toHaveBeenCalledTimes(1);
    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
      "DELETE FROM sqlite_sequence WHERE name IN ('AiTrace','Audit','Website','Rule','Occurrence')",
    );
    expect(result).toEqual({ message: 'Histórico borrado' });
  });

  it('rejects compare requests with the same audit id', async () => {
    await expect(
      controller.compareAudits({ old: 5, new: 5 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(auditService.compareAudits).not.toHaveBeenCalled();
  });

  it('parses detail arrays defensively and falls back to empty arrays', async () => {
    prisma.audit.findUnique.mockResolvedValue({
      id: 3,
      website: { url: 'https://example.com/' },
      timestamp: new Date('2026-04-10T12:00:00.000Z'),
      status: 'failed',
      notes: 'Timeout previo',
      rawJson: { ok: true },
      rules: [
        {
          id: 11,
          ruleId: 'image-alt',
          impact: 'serious',
          description: 'Images must have alternate text',
          help: 'Add alt text',
          helpUrl: 'https://example.com/image-alt',
          wcag: 'invalid-json',
          type: 'violations',
        },
      ],
      occurrences: [
        {
          id: 21,
          ruleRef: 11,
          htmlSnippet: '<img>',
          target: '{"not":"an-array"}',
          failureSummary: 'Missing alt',
        },
      ],
    });

    const result = await controller.getAuditById(3, { occurrenceLimit: 5 });

    expect(prisma.audit.findUnique).toHaveBeenCalledWith({
      where: { id: 3 },
      include: {
        website: true,
        rules: true,
        occurrences: {
          take: 5,
          orderBy: { id: 'asc' },
        },
      },
    });
    expect(result.rules[0].wcag).toEqual([]);
    expect(result.occurrences[0].target).toEqual([]);
    expect(result.status).toBe('failed');
    expect(result.notes).toBe('Timeout previo');
  });

  it('updates only the provided fields', async () => {
    prisma.audit.findUnique.mockResolvedValue({
      id: 9,
      status: 'running',
      notes: null,
    });
    prisma.audit.update.mockResolvedValue({
      id: 9,
      status: 'completed',
      notes: null,
    });

    const result = await controller.updateAudit(9, { status: 'completed' });

    expect(prisma.audit.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: { status: 'completed' },
    });
    expect(result).toEqual({ id: 9, status: 'completed', notes: null });
  });

  it('throws when the audit detail does not exist', async () => {
    prisma.audit.findUnique.mockResolvedValue(null);

    await expect(
      controller.getAuditById(404, { occurrenceLimit: 10 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
