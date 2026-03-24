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
import { AuditService } from './audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAuditDto } from './dto/create-audit.dto';
import { CompareAuditDto } from './dto/compare-audit.dto';
import { ListAuditsDto } from './dto/list-audits.dto';
import { AuditDetailQueryDto } from './dto/audit-detail-query.dto';
import { UpdateAuditDto } from './dto/update-audit.dto';

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

    const total = await this.prisma.audit.count();
    const audits = await this.prisma.audit.findMany({
      skip,
      take: pageSize,
      include: {
        website: true,
      },
      orderBy: { timestamp: order },
    });

    return {
      total,
      page,
      pageSize,
      items: audits.map((a) => ({
        id: a.id,
        website: a.website.url,
        timestamp: a.timestamp,
        status: (a as any).status ?? null,
        notes: (a as any).notes ?? null,
      })),
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
      await tx.occurrence.deleteMany();
      await tx.rule.deleteMany();
      await tx.audit.deleteMany();
      await tx.website.deleteMany();
      // Reset autoincrement counters en SQLite
      await tx.$executeRawUnsafe(
        `DELETE FROM sqlite_sequence WHERE name IN ('Audit','Website','Rule','Occurrence')`,
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
  async getAuditRuntime() {
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

    return {
      id: audit.id,
      url: audit.website.url,
      timestamp: audit.timestamp,
      status: (audit as any).status ?? null,
      notes: (audit as any).notes ?? null,
      rawJson: audit.rawJson,
      rules: audit.rules.map((r) => ({
        id: r.id,
        ruleId: r.ruleId,
        impact: r.impact,
        description: r.description,
        help: r.help,
        helpUrl: r.helpUrl,
        wcag: JSON.parse(r.wcag ?? '[]'),
        type: r.type,
      })),
      occurrences: audit.occurrences.map((o) => ({
        id: o.id,
        ruleRef: o.ruleRef,
        htmlSnippet: o.htmlSnippet,
        target: JSON.parse(o.target),
        failureSummary: o.failureSummary,
      })),
    };
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

    const data: any = {};
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.notes !== undefined) data.notes = dto.notes;

    const updated = await this.prisma.audit.update({
      where: { id },
      data,
    });

    return {
      id: updated.id,
      status: (updated as any).status ?? null,
      notes: (updated as any).notes ?? null,
    };
  }
}
