import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller('websites')
export class WebsiteController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /websites/:id/audits
   * Lista auditorías de un sitio web concreto
   */
  @Get(':id/audits')
  async getAuditsByWebsite(@Param('id', ParseIntPipe) id: number) {
    const website = await this.prisma.website.findUnique({
      where: { id },
      include: {
        audits: {
          orderBy: { timestamp: 'desc' },
        },
      },
    });

    if (!website) {
      throw new NotFoundException(`No existe Website con ID ${id}`);
    }

    return {
      website: website.url,
      audits: website.audits.map((a) => ({
        id: a.id,
        timestamp: a.timestamp,
      })),
    };
  }
}
