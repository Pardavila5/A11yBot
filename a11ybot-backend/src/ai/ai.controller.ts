import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
} from '@nestjs/common';
import { AiService } from './ai.service';
import { AiAuditOptionsDto } from './dto/ai-audit-options.dto';
import { AiCompareQueryDto } from './dto/ai-compare-query.dto';
import { AiRuleExplainQueryDto } from './dto/ai-rule-explain-query.dto';
import { AiTraceStatsDto } from './dto/ai-trace-stats.dto';
import { ListAiTracesDto } from './dto/list-ai-traces.dto';

@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  /**
   * GET /ai/audits/:id/summary
   * Resumen de auditoria con capa IA (o fallback heuristico)
   */
  @Get('audits/:id/summary')
  async getAuditSummary(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: AiAuditOptionsDto,
  ) {
    return this.aiService.getAuditSummary(id, query);
  }

  /**
   * GET /ai/audits/:id/summary/ab
   * Evaluacion A/B: heuristico vs IA para una auditoria
   */
  @Get('audits/:id/summary/ab')
  async getAuditSummaryAB(@Param('id', ParseIntPipe) id: number) {
    return this.aiService.getAuditSummaryAB(id);
  }

  /**
   * GET /ai/audits/:id/rules/:ruleId/explain
   * Explicacion accionable de una regla concreta en una auditoria
   */
  @Get('audits/:id/rules/:ruleId/explain')
  async explainRule(
    @Param('id', ParseIntPipe) id: number,
    @Param('ruleId') ruleId: string,
    @Query() query: AiRuleExplainQueryDto,
  ) {
    return this.aiService.explainRuleInAudit(id, ruleId, query);
  }

  /**
   * GET /ai/compare?old=ID&new=ID
   * Resumen inteligente de comparacion entre auditorias
   */
  @Get('compare')
  async compareAudits(@Query() query: AiCompareQueryDto) {
    if (query.old === query.new) {
      throw new BadRequestException('Los IDs de auditoria deben ser distintos');
    }
    return this.aiService.getComparisonSummary(query.old, query.new, query);
  }

  /**
   * GET /ai/compare/ab?old=ID&new=ID
   * Evaluacion A/B: heuristico vs IA para comparacion
   */
  @Get('compare/ab')
  async compareAuditsAB(@Query() query: AiCompareQueryDto) {
    if (query.old === query.new) {
      throw new BadRequestException('Los IDs de auditoria deben ser distintos');
    }
    return this.aiService.getComparisonSummaryAB(query.old, query.new);
  }

  /**
   * GET /ai/traces
   * Traza de llamadas IA para analisis y memoria del TFG
   */
  @Get('traces')
  async getTraces(@Query() query: ListAiTracesDto) {
    return this.aiService.listTraces(query);
  }

  /**
   * GET /ai/traces/stats
   * Agregados para analitica del TFG (uso IA, latencia, fallback)
   */
  @Get('traces/stats')
  async getTraceStats(@Query() query: AiTraceStatsDto) {
    return this.aiService.getTraceStats(query);
  }
}
