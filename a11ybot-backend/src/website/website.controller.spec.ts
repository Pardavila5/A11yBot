import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WebsiteController } from './website.controller';

describe('WebsiteController', () => {
  let controller: WebsiteController;
  let prisma: {
    website: {
      findUnique: jest.Mock;
    };
  };

  beforeEach(() => {
    prisma = {
      website: {
        findUnique: jest.fn(),
      },
    };

    controller = new WebsiteController(prisma as unknown as PrismaService);
  });

  it('returns audits for an existing website ordered by timestamp', async () => {
    prisma.website.findUnique.mockResolvedValue({
      id: 3,
      url: 'https://example.com',
      audits: [
        { id: 9, timestamp: new Date('2026-04-13T11:00:00.000Z') },
        { id: 8, timestamp: new Date('2026-04-12T11:00:00.000Z') },
      ],
    });

    const result = await controller.getAuditsByWebsite(3);

    expect(prisma.website.findUnique).toHaveBeenCalledWith({
      where: { id: 3 },
      include: {
        audits: {
          orderBy: { timestamp: 'desc' },
        },
      },
    });
    expect(result).toEqual({
      website: 'https://example.com',
      audits: [
        { id: 9, timestamp: new Date('2026-04-13T11:00:00.000Z') },
        { id: 8, timestamp: new Date('2026-04-12T11:00:00.000Z') },
      ],
    });
  });

  it('throws when the website does not exist', async () => {
    prisma.website.findUnique.mockResolvedValue(null);

    await expect(controller.getAuditsByWebsite(404)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
