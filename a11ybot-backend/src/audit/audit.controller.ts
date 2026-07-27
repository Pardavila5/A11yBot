import {
  Controller,
  Get,
  Param,
  NotFoundException,
  ParseIntPipe,
  Post,
  Body,
  Query,
  BadRequestException,
  Patch,
  Delete,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from './audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAuditDto } from './dto/create-audit.dto';
import { CompareAuditDto } from './dto/compare-audit.dto';
import { ListAuditsDto } from './dto/list-audits.dto';
import { AuditDetailQueryDto } from './dto/audit-detail-query.dto';
import { UpdateAuditDto } from './dto/update-audit.dto';

type AuditListRecord = {
  id: number;
  website: { url: string };
  timestamp: Date;
  status: string | null;
  notes: string | null;
  rules?: { type: string }[];
};

type AuditDetailRecord = Omit<AuditListRecord, 'rules'> & {
  rawJson: unknown;
  rules: Array<{
    id: number;
    ruleId: string;
    impact: string | null;
    description: string;
    help: string;
    helpUrl: string;
    wcag: string | null;
    type: string;
  }>;
  occurrences: Array<{
    id: number;
    ruleRef: number;
    htmlSnippet: string;
    target: string | null;
    failureSummary: string | null;
  }>;
};

@Controller('audits')
export class AuditController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * GET /audits
   * Lista todas las auditorías
   */
  @Get()
  async getAllAudits(@Query() query: ListAuditsDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const order = query.order ?? 'desc';
    const skip = (page - 1) * pageSize;
    const where = this.buildListWhere(query);

    const total = await this.prisma.audit.count({ where });
    const audits = await this.prisma.audit.findMany({
      skip,
      take: pageSize,
      where,
      include: {
        website: true,
        rules: { select: { type: true } },
      },
      orderBy: { timestamp: order },
    });

    return {
      total,
      page,
      pageSize,
      items: audits.map((audit) => this.mapListItem(audit)),
    };
  }

  /**
   * POST /audits
   * Ejecuta una auditoría y guarda los resultados
   */
  @Post()
  async createAudit(@Body() dto: CreateAuditDto) {
    return this.auditService.runAudit(dto.url);
  }

  /**
   * DELETE /audits
   * Borra el histórico completo
   */
  @Delete()
  async deleteAll() {
    await this.prisma.$transaction(async (tx) => {
      await tx.aiTrace.deleteMany();
      await tx.occurrence.deleteMany();
      await tx.rule.deleteMany();
      await tx.audit.deleteMany();
      await tx.website.deleteMany();
      // Reset autoincrement counters en SQLite
      await tx.$executeRawUnsafe(
        `DELETE FROM sqlite_sequence WHERE name IN ('AiTrace','Audit','Website','Rule','Occurrence')`,
      );
    });
    return { message: 'Histórico borrado' };
  }

  /**
   * GET /audits/compare?old=ID&new=ID
   * Compara dos auditorías (solo violaciones)
   */
  @Get('compare')
  async compareAudits(@Query() query: CompareAuditDto) {
    if (query.old === query.new) {
      throw new BadRequestException('Los IDs de auditoría deben ser distintos');
    }

    return this.auditService.compareAudits(query.old, query.new);
  }

  /**
   * GET /audits/runtime
   * Estado de cola/concurrencia de auditorias en memoria
   */
  @Get('runtime')
  getAuditRuntime() {
    return this.auditService.getAuditRuntimeStats();
  }

  /**
   * GET /audits/:id
   * Detalle completo de una auditoría (rules + occurrences)
   */
  @Get(':id')
  async getAuditById(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: AuditDetailQueryDto,
  ) {
    const audit = await this.prisma.audit.findUnique({
      where: { id },
      include: {
        website: true,
        rules: true,
        occurrences: {
          take: query.occurrenceLimit,
          orderBy: { id: 'asc' },
        },
      },
    });

    if (!audit) {
      throw new NotFoundException(`No existe auditoría con ID ${id}`);
    }

    return this.mapDetail(audit);
  }

  /**
   * PATCH /audits/:id
   * Actualiza status y/o notes de una auditoría
   */
  @Patch(':id')
  async updateAudit(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAuditDto,
  ) {
    const audit = await this.prisma.audit.findUnique({ where: { id } });
    if (!audit) {
      throw new NotFoundException(`No existe auditoría con ID ${id}`);
    }

    const data: { status?: string; notes?: string | null } = {};
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.notes !== undefined) data.notes = dto.notes;

    const updated = await this.prisma.audit.update({
      where: { id },
      data,
    });

    return {
      id: updated.id,
      status: updated.status ?? null,
      notes: updated.notes ?? null,
    };
  }

  private mapListItem(audit: AuditListRecord) {
    const counts = { violations: 0, passes: 0, incomplete: 0 };
    for (const rule of audit.rules ?? []) {
      if (rule.type === 'violations') counts.violations += 1;
      else if (rule.type === 'passes') counts.passes += 1;
      else if (rule.type === 'incomplete') counts.incomplete += 1;
    }
    return {
      id: audit.id,
      website: audit.website.url,
      timestamp: audit.timestamp,
      status: audit.status ?? null,
      notes: audit.notes ?? null,
      counts,
    };
  }

  private buildListWhere(query: ListAuditsDto): Prisma.AuditWhereInput {
    const where: Prisma.AuditWhereInput = {};

    if (query.status) {
      where.status = query.status;
    }

    const search = query.search?.trim();
    if (search) {
      where.website = {
        url: {
          contains: search,
        },
      };
    }

    return where;
  }

  private mapDetail(audit: AuditDetailRecord) {
    return {
      id: audit.id,
      url: audit.website.url,
      timestamp: audit.timestamp,
      status: audit.status ?? null,
      notes: audit.notes ?? null,
      rawJson: audit.rawJson,
      rules: audit.rules.map((rule) => ({
        id: rule.id,
        ruleId: rule.ruleId,
        impact: rule.impact,
        description: rule.description,
        help: rule.help,
        helpUrl: rule.helpUrl,
        wcag: this.parseJsonStringArray(rule.wcag),
        type: rule.type,
      })),
      occurrences: audit.occurrences.map((occurrence) => ({
        id: occurrence.id,
        ruleRef: occurrence.ruleRef,
        htmlSnippet: occurrence.htmlSnippet,
        target: this.parseJsonStringArray(occurrence.target),
        failureSummary: occurrence.failureSummary,
      })),
    };
  }

  private parseJsonStringArray(value: string | null | undefined): string[] {
    try {
      const parsed: unknown = JSON.parse(value ?? '[]');
      return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
    } catch {
      return [];
    }
  }
}
