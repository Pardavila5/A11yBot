import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { AiAuditOptionsDto } from './dto/ai-audit-options.dto';
import { AiTraceStatsDto } from './dto/ai-trace-stats.dto';
import { AiRuleExplainQueryDto } from './dto/ai-rule-explain-query.dto';
import { ListAiTracesDto } from './dto/list-ai-traces.dto';

type AiSource = 'heuristic' | 'openai';

type AiRecommendation = {
  title: string;
  reason: string;
  actions: string[];
  priority: 'high' | 'medium' | 'low';
  ruleId?: string;
};

type TopViolation = {
  ruleId: string;
  impact: string | null;
  occurrences: number;
  score: number;
};

type OpenAiAttempt = {
  attempted: boolean;
  configuredModel: string | null;
  responseModel: string | null;
  latencyMs: number | null;
  status: string | null;
  httpStatus: number | null;
  errorMessage: string | null;
};

@Injectable()
export class AiService implements OnModuleInit {
  private readonly logger = new Logger(AiService.name);
  private warnedMissingApiKey = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    const hasApiKey = !!this.config.get<string>('OPENAI_API_KEY');
    this.logger.log(
      `IA init: model=${this.getConfiguredModel()} apiKey=${hasApiKey ? 'configured' : 'missing'} baseUrl=${this.getBaseUrl()}`,
    );
  }

  async listTraces(query: ListAiTracesDto) {
    const limit = query.limit ?? 50;
    const items = await this.prisma.aiTrace.findMany({
      take: limit,
      where: {
        operation: query.operation,
        source: query.source,
        auditId: query.auditId,
      },
      orderBy: { createdAt: 'desc' },
    });
    return { total: items.length, items };
  }

  async getTraceStats(query: AiTraceStatsDto) {
    const where: any = {
      operation: query.operation,
      source: query.source,
    };
    if (query.sinceDays) {
      where.createdAt = {
        gte: new Date(Date.now() - query.sinceDays * 24 * 60 * 60 * 1000),
      };
    }

    const items = await this.prisma.aiTrace.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 2000,
    });

    const total = items.length;
    const byOperation: Record<string, number> = {};
    const bySource: Record<string, number> = {};
    const byAttemptStatus: Record<string, number> = {};
    const byModel: Record<string, number> = {};
    let totalLatency = 0;
    let openAiCount = 0;
    let openAiLatency = 0;
    let heuristicCount = 0;

    for (const item of items) {
      byOperation[item.operation] = (byOperation[item.operation] ?? 0) + 1;
      bySource[item.source] = (bySource[item.source] ?? 0) + 1;
      if (item.model) {
        byModel[item.model] = (byModel[item.model] ?? 0) + 1;
      }
      totalLatency += item.latencyMs;
      if (item.source === 'openai') {
        openAiCount += 1;
        openAiLatency += item.latencyMs;
      } else {
        heuristicCount += 1;
      }

      const status = this.extractAttemptStatus(item.responseMeta);
      byAttemptStatus[status] = (byAttemptStatus[status] ?? 0) + 1;
    }

    return {
      window: {
        sinceDays: query.sinceDays ?? null,
        total,
      },
      usage: {
        byOperation,
        bySource,
        byModel,
        fallbackRate: total > 0 ? heuristicCount / total : 0,
        openAiRate: total > 0 ? openAiCount / total : 0,
      },
      latency: {
        avgMs: total > 0 ? Math.round(totalLatency / total) : 0,
        openAiAvgMs:
          openAiCount > 0 ? Math.round(openAiLatency / openAiCount) : 0,
      },
      attempts: {
        byStatus: byAttemptStatus,
      },
    };
  }

  async getAuditSummaryAB(auditId: number) {
    const [heuristic, assisted] = await Promise.all([
      this.getAuditSummary(auditId, { forceHeuristic: true }),
      this.getAuditSummary(auditId, { forceHeuristic: false }),
    ]);

    return {
      generatedAt: new Date().toISOString(),
      operation: 'audit_summary',
      auditId,
      heuristic,
      assisted,
      diff: {
        sourceChanged: assisted.source !== heuristic.source,
        recommendationDelta:
          assisted.recommendations.length - heuristic.recommendations.length,
      },
    };
  }

  async getComparisonSummaryAB(oldId: number, newId: number) {
    const [heuristic, assisted] = await Promise.all([
      this.getComparisonSummary(oldId, newId, { forceHeuristic: true }),
      this.getComparisonSummary(oldId, newId, { forceHeuristic: false }),
    ]);

    return {
      generatedAt: new Date().toISOString(),
      operation: 'compare_summary',
      oldId,
      newId,
      heuristic,
      assisted,
      diff: {
        sourceChanged: assisted.source !== heuristic.source,
        recommendationDelta:
          assisted.recommendations.length - heuristic.recommendations.length,
      },
    };
  }

  async getAuditSummary(auditId: number, options: AiAuditOptionsDto) {
    this.logger.log(
      `AI audit_summary request: auditId=${auditId} forceHeuristic=${options.forceHeuristic === true}`,
    );

    const startedAt = Date.now();
    const attempt = this.newAttempt();
    const audit = await this.prisma.audit.findUnique({
      where: { id: auditId },
      include: { website: true, rules: true, occurrences: true },
    });
    if (!audit) {
      throw new NotFoundException(`No existe auditoría con ID ${auditId}`);
    }

    const violations = audit.rules.filter((r) => r.type === 'violations');
    const topViolations = this.getTopViolations(
      violations,
      audit.occurrences,
      options.maxRules,
    );
    const ruleIdsForSummary =
      topViolations.length > 0
        ? topViolations.map((item) => item.ruleId)
        : violations.map((r) => r.ruleId);
    const heuristic = this.heuristicAudit(
      audit.website.url,
      violations.length,
      audit.occurrences.length,
      topViolations,
    );

    let source: AiSource = 'heuristic';
    let model: string | null = null;
    let executiveSummary = heuristic.executiveSummary;
    let technicalSummary = heuristic.technicalSummary;
    let recommendations = heuristic.recommendations;

    if (options.forceHeuristic) {
      attempt.status = 'forced_heuristic';
      attempt.errorMessage = 'forceHeuristic=true';
    } else {
      const ai = await this.generateOpenAiAuditSummary(
        {
          auditId,
          url: audit.website.url,
          rules: ruleIdsForSummary,
          occurrences: audit.occurrences.length,
          topViolations,
        },
        attempt,
      );

      if (ai) {
        source = 'openai';
        model = ai.model;
        executiveSummary = ai.executiveSummary;
        technicalSummary = ai.technicalSummary;
        recommendations =
          ai.recommendations.length > 0
            ? ai.recommendations
            : heuristic.recommendations;

        if (ai.recommendations.length === 0) {
          this.logger.warn(
            'OpenAI audit_summary sin recomendaciones válidas; se usan recomendaciones heurísticas.',
          );
        }
      }
    }

    recommendations = this.limitRecommendations(
      recommendations,
      options.maxRecommendations,
    );

    const traceId = await this.saveTrace({
      operation: 'audit_summary',
      source,
      model: model ?? attempt.responseModel ?? attempt.configuredModel,
      auditId,
      compareOldAudit: null,
      compareNewAudit: null,
      ruleId: null,
      latencyMs: Date.now() - startedAt,
      success: true,
      errorMessage: attempt.errorMessage,
      requestMeta: {
        forceHeuristic: options.forceHeuristic ?? false,
        maxRecommendations: options.maxRecommendations ?? null,
        maxRules: options.maxRules ?? null,
      },
      responseMeta: {
        openAiAttempt: attempt,
        recommendations: recommendations.length,
      },
    });

    this.logAiResolution('audit_summary', source, attempt, traceId);

    return {
      traceId,
      source,
      generatedAt: new Date().toISOString(),
      model,
      audit: {
        id: audit.id,
        url: audit.website.url,
        timestamp: audit.timestamp,
        status: (audit as any).status ?? null,
      },
      metrics: {
        rules: {
          total: audit.rules.length,
          violations: violations.length,
          passes: audit.rules.filter((r) => r.type === 'passes').length,
          incomplete: audit.rules.filter((r) => r.type === 'incomplete').length,
        },
        occurrences: audit.occurrences.length,
        topViolations,
      },
      executiveSummary,
      technicalSummary,
      recommendations,
    };
  }

  async getComparisonSummary(
    oldId: number,
    newId: number,
    options: AiAuditOptionsDto,
  ) {
    this.logger.log(
      `AI compare_summary request: oldId=${oldId} newId=${newId} forceHeuristic=${options.forceHeuristic === true}`,
    );

    const startedAt = Date.now();
    const attempt = this.newAttempt();
    const compare = await this.auditService.compareAudits(oldId, newId);
    const heuristic = this.heuristicCompare(
      compare.summary.newViolationRules,
      compare.summary.resolvedViolationRules,
      compare.summary.persistentViolationRules,
    );

    let source: AiSource = 'heuristic';
    let model: string | null = null;
    let executiveSummary = heuristic.executiveSummary;
    let technicalSummary = heuristic.technicalSummary;
    let recommendations = heuristic.recommendations;

    if (options.forceHeuristic) {
      attempt.status = 'forced_heuristic';
      attempt.errorMessage = 'forceHeuristic=true';
    } else {
      const ai = await this.generateOpenAiCompareSummary(
        { oldId, newId, summary: compare.summary },
        attempt,
      );

      if (ai) {
        source = 'openai';
        model = ai.model;
        executiveSummary = ai.executiveSummary;
        technicalSummary = ai.technicalSummary;
        recommendations =
          ai.recommendations.length > 0
            ? ai.recommendations
            : heuristic.recommendations;

        if (ai.recommendations.length === 0) {
          this.logger.warn(
            'OpenAI compare_summary sin recomendaciones válidas; se usan recomendaciones heurísticas.',
          );
        }
      }
    }

    recommendations = this.limitRecommendations(
      recommendations,
      options.maxRecommendations,
    );

    const traceId = await this.saveTrace({
      operation: 'compare_summary',
      source,
      model: model ?? attempt.responseModel ?? attempt.configuredModel,
      auditId: null,
      compareOldAudit: oldId,
      compareNewAudit: newId,
      ruleId: null,
      latencyMs: Date.now() - startedAt,
      success: true,
      errorMessage: attempt.errorMessage,
      requestMeta: {
        forceHeuristic: options.forceHeuristic ?? false,
        maxRecommendations: options.maxRecommendations ?? null,
      },
      responseMeta: {
        openAiAttempt: attempt,
        recommendations: recommendations.length,
      },
    });

    this.logAiResolution('compare_summary', source, attempt, traceId);

    return {
      traceId,
      source,
      generatedAt: new Date().toISOString(),
      model,
      audits: compare.audits,
      summary: compare.summary,
      executiveSummary,
      technicalSummary,
      recommendations,
    };
  }

  async explainRuleInAudit(
    auditId: number,
    ruleId: string,
    options: AiRuleExplainQueryDto,
  ) {
    this.logger.log(
      `AI rule_explain request: auditId=${auditId} ruleId=${ruleId} forceHeuristic=${options.forceHeuristic === true}`,
    );

    const startedAt = Date.now();
    const attempt = this.newAttempt();
    const audit = await this.prisma.audit.findUnique({
      where: { id: auditId },
      include: { website: true, rules: true, occurrences: true },
    });
    if (!audit) {
      throw new NotFoundException(`No existe auditoría con ID ${auditId}`);
    }

    const rule = audit.rules.find((r) => r.ruleId === ruleId) ?? null;
    if (!rule) {
      throw new NotFoundException(
        `La regla ${ruleId} no existe en la auditoría ${auditId}`,
      );
    }

    const matchingOccurrences = audit.occurrences.filter((o) => o.ruleRef === rule.id);
    const samples = matchingOccurrences
      .slice(0, options.maxOccurrences ?? 3)
      .map((occurrence) => ({
        target: this.parseJsonArray(occurrence.target),
        failureSummary: occurrence.failureSummary ?? null,
        htmlSnippet: occurrence.htmlSnippet,
      }));

    const fallback = {
      summary: `La regla ${ruleId} requiere corrección priorizada.`,
      whyItMatters: `Impacto: ${rule.impact ?? 'n/a'}.`,
      fixes: [
        'Corregir componente base.',
        'Validar con teclado.',
        'Reauditar.',
      ],
      testChecklist: [
        'Navegación por teclado',
        'Lector de pantalla',
        'Reauditoría',
      ],
    };

    let source: AiSource = 'heuristic';
    let model: string | null = null;
    let explanation = fallback;

    if (options.forceHeuristic) {
      attempt.status = 'forced_heuristic';
      attempt.errorMessage = 'forceHeuristic=true';
    } else {
      const ai = await this.generateOpenAiRuleExplanation(
        {
          auditId,
          ruleId,
          impact: rule.impact ?? null,
          description: rule.description,
          occurrences: matchingOccurrences.length,
          samples,
        },
        attempt,
      );
      if (ai) {
        source = 'openai';
        model = ai.model;
        explanation = ai.explanation;
      }
    }

    const traceId = await this.saveTrace({
      operation: 'rule_explain',
      source,
      model: model ?? attempt.responseModel ?? attempt.configuredModel,
      auditId,
      compareOldAudit: null,
      compareNewAudit: null,
      ruleId,
      latencyMs: Date.now() - startedAt,
      success: true,
      errorMessage: attempt.errorMessage,
      requestMeta: {
        forceHeuristic: options.forceHeuristic ?? false,
        maxOccurrences: options.maxOccurrences ?? null,
      },
      responseMeta: { openAiAttempt: attempt },
    });

    this.logAiResolution('rule_explain', source, attempt, traceId);

    return {
      traceId,
      source,
      generatedAt: new Date().toISOString(),
      model,
      audit: {
        id: audit.id,
        url: audit.website.url,
        timestamp: audit.timestamp.toISOString(),
        status: (audit as any).status ?? null,
      },
      rule: {
        ruleId: rule.ruleId,
        type: rule.type,
        impact: rule.impact ?? null,
        description: rule.description,
        help: rule.help,
        helpUrl: rule.helpUrl,
        wcag: this.parseJsonArray(rule.wcag),
        occurrences: matchingOccurrences.length,
        samples,
      },
      explanation,
    };
  }

  private heuristicAudit(
    url: string,
    violations: number,
    occurrences: number,
    topViolations: TopViolation[],
  ) {
    const executiveSummary = `En ${url} se detectaron ${violations} violaciones y ${occurrences} ocurrencias.`;
    const technicalSummary =
      topViolations.length > 0
        ? `Prioriza: ${topViolations.map((item) => item.ruleId).join(', ')}.`
        : 'No hay reglas críticas para priorizar.';
    const recommendations: AiRecommendation[] = topViolations.slice(0, 3).map(
      (item) => ({
        title: `Corregir ${item.ruleId}`,
        reason: `Regla prioritaria por impacto/recurrencia (ocurrencias: ${item.occurrences}).`,
        actions: [
          'Aplicar fix en componente base',
          'Verificar con teclado',
          'Reauditar',
        ],
        priority: item.score >= 8 ? 'high' : item.score >= 4 ? 'medium' : 'low',
        ruleId: item.ruleId,
      }),
    );

    return {
      executiveSummary,
      technicalSummary,
      recommendations: recommendations.length
        ? recommendations
        : [
            {
              title: 'Mantener baseline',
              reason: 'Sin incidencias prioritarias.',
              actions: ['Mantener CI de accesibilidad'],
              priority: 'low' as const,
            },
          ],
    };
  }

  private heuristicCompare(newRules: number, resolved: number, persistent: number) {
    const executiveSummary = `Nuevas: ${newRules}, resueltas: ${resolved}, persistentes: ${persistent}.`;
    const technicalSummary =
      newRules > 0
        ? 'Ataca primero regresiones.'
        : 'Sin regresiones nuevas, enfoca persistentes.';
    const recommendations: AiRecommendation[] = [
      {
        title: 'Plan de acción',
        reason: 'Reducir regresiones y persistentes.',
        actions: [
          'Crear tickets por regla',
          'Corregir por impacto',
          'Reauditar',
        ],
        priority: newRules > 0 ? 'high' : 'medium',
      },
    ];
    return { executiveSummary, technicalSummary, recommendations };
  }

  private getTopViolations(
    rules: Array<{ id: number; ruleId: string; impact: string | null }>,
    occurrences: Array<{ ruleRef: number }>,
    limit?: number,
  ): TopViolation[] {
    const occurrenceCounts = new Map<number, number>();
    for (const occurrence of occurrences) {
      occurrenceCounts.set(
        occurrence.ruleRef,
        (occurrenceCounts.get(occurrence.ruleRef) ?? 0) + 1,
      );
    }

    const items = rules
      .map((rule) => {
        const count = occurrenceCounts.get(rule.id) ?? 0;
        return {
          ruleId: rule.ruleId,
          impact: rule.impact,
          occurrences: count,
          score: count * this.getImpactWeight(rule.impact),
        };
      })
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (b.occurrences !== a.occurrences) return b.occurrences - a.occurrences;
        return a.ruleId.localeCompare(b.ruleId);
      });

    return items.slice(0, limit ?? 5);
  }

  private getImpactWeight(impact: string | null): number {
    if (impact === 'critical') return 5;
    if (impact === 'serious') return 4;
    if (impact === 'moderate') return 3;
    if (impact === 'minor') return 2;
    return 1;
  }

  private limitRecommendations(
    recommendations: AiRecommendation[],
    limit?: number,
  ): AiRecommendation[] {
    return recommendations.slice(0, limit ?? recommendations.length);
  }

  private async generateOpenAiAuditSummary(input: any, attempt: OpenAiAttempt) {
    const payload = await this.requestOpenAiJson(
      'Devuelve SOLO JSON con executiveSummary, technicalSummary y recommendations.',
      input,
      attempt,
    );
    if (!payload) return null;

    const executiveSummary = this.getString(payload, 'executiveSummary');
    const technicalSummary = this.getString(payload, 'technicalSummary');
    const recommendations = this.getRecommendations(payload);

    if (!executiveSummary || !technicalSummary) {
      this.logger.warn(
        `OpenAI audit_summary incompleto: executive=${!!executiveSummary} technical=${!!technicalSummary}`,
      );
      return null;
    }

    return {
      model: this.getString(payload, '_model') ?? this.getConfiguredModel(),
      executiveSummary,
      technicalSummary,
      recommendations,
    };
  }

  private async generateOpenAiCompareSummary(
    input: any,
    attempt: OpenAiAttempt,
  ) {
    const payload = await this.requestOpenAiJson(
      'Devuelve SOLO JSON con executiveSummary, technicalSummary y recommendations.',
      input,
      attempt,
    );
    if (!payload) return null;

    const executiveSummary = this.getString(payload, 'executiveSummary');
    const technicalSummary = this.getString(payload, 'technicalSummary');
    const recommendations = this.getRecommendations(payload);

    if (!executiveSummary || !technicalSummary) {
      this.logger.warn(
        `OpenAI compare_summary incompleto: executive=${!!executiveSummary} technical=${!!technicalSummary}`,
      );
      return null;
    }

    return {
      model: this.getString(payload, '_model') ?? this.getConfiguredModel(),
      executiveSummary,
      technicalSummary,
      recommendations,
    };
  }

  private async generateOpenAiRuleExplanation(
    input: any,
    attempt: OpenAiAttempt,
  ) {
    const payload = await this.requestOpenAiJson(
      'Devuelve SOLO JSON con summary, whyItMatters, fixes y testChecklist.',
      input,
      attempt,
    );
    if (!payload) return null;

    const summary = this.getString(payload, 'summary');
    const whyItMatters = this.getString(payload, 'whyItMatters');
    const fixes = this.getStringArray(payload, 'fixes');
    const testChecklist = this.getStringArray(payload, 'testChecklist');

    if (!summary || !whyItMatters) {
      this.logger.warn(
        `OpenAI rule_explain incompleto: summary=${!!summary} whyItMatters=${!!whyItMatters}`,
      );
      return null;
    }

    return {
      model: this.getString(payload, '_model') ?? this.getConfiguredModel(),
      explanation: {
        summary,
        whyItMatters,
        fixes:
          fixes.length > 0
            ? fixes
            : [
                'Corregir en componente base.',
                'Validar navegación por teclado.',
                'Reauditar.',
              ],
        testChecklist:
          testChecklist.length > 0
            ? testChecklist
            : [
                'Navegación por teclado',
                'Lector de pantalla',
                'Reauditoría',
              ],
      },
    };
  }

  private async requestOpenAiJson(
    systemPrompt: string,
    userPayload: unknown,
    attempt: OpenAiAttempt,
  ): Promise<Record<string, unknown> | null> {
    const startedAt = Date.now();
    attempt.configuredModel = this.getConfiguredModel();
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    if (!apiKey) {
      attempt.status = 'not_configured';
      attempt.errorMessage = 'OPENAI_API_KEY no configurada';
      if (!this.warnedMissingApiKey) {
        this.logger.warn(
          'OPENAI_API_KEY no configurada. Se usará fallback heurístico.',
        );
        this.warnedMissingApiKey = true;
      }
      return null;
    }

    attempt.attempted = true;
    const model = attempt.configuredModel;
    const timeoutMs = this.getOpenAiTimeoutMs();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      this.logger.log(`OpenAI request start [${model}] timeout=${timeoutMs}ms`);
      const res = await fetch(`${this.getBaseUrl()}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: JSON.stringify(userPayload) },
          ],
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text();
        attempt.status = 'http_error';
        attempt.httpStatus = res.status;
        attempt.errorMessage = text.slice(0, 200);
        attempt.latencyMs = Date.now() - startedAt;
        this.logger.warn(
          `OpenAI request falló (${res.status}) [${model}]: ${text.slice(0, 200)}`,
        );
        return null;
      }

      const data = (await res.json()) as any;
      const content = data?.choices?.[0]?.message?.content ?? '';
      const parsed = this.tryParseJson(content);
      if (!parsed) {
        attempt.status = 'parse_error';
        attempt.errorMessage = 'OpenAI respondió sin JSON válido';
        attempt.latencyMs = Date.now() - startedAt;
        this.logger.warn(
          `OpenAI parse_error [${model}] content="${String(content).slice(0, 160)}"`,
        );
        return null;
      }

      attempt.status = 'success';
      attempt.responseModel = data?.model ?? model;
      attempt.latencyMs = Date.now() - startedAt;
      this.logger.log(`OpenAI OK [${attempt.responseModel}] ${attempt.latencyMs}ms`);
      return { ...parsed, _model: attempt.responseModel };
    } catch (error: any) {
      const isAbort = error?.name === 'AbortError';
      attempt.status = isAbort ? 'timeout' : 'exception';
      attempt.errorMessage = isAbort
        ? `Timeout tras ${timeoutMs}ms`
        : `${error?.message ?? error}`.slice(0, 200);
      attempt.latencyMs = Date.now() - startedAt;
      this.logger.warn(
        `OpenAI no disponible, se usará fallback heurístico: ${attempt.errorMessage}`,
      );
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  private tryParseJson(value: string): Record<string, unknown> | null {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  private getRecommendations(payload: Record<string, unknown>): AiRecommendation[] {
    const raw = payload.recommendations;
    if (!Array.isArray(raw)) return [];

    return raw
      .filter(
        (entry): entry is Record<string, unknown> =>
          !!entry && typeof entry === 'object',
      )
      .map((entry) => ({
        title: this.getString(entry, 'title') ?? '',
        reason: this.getString(entry, 'reason') ?? '',
        actions: this.getStringArray(entry, 'actions'),
        priority:
          (this.getString(entry, 'priority') as 'high' | 'medium' | 'low') ??
          'medium',
        ruleId: this.getString(entry, 'ruleId') ?? undefined,
      }))
      .filter(
        (entry) =>
          entry.title.length > 0 &&
          entry.reason.length > 0 &&
          entry.actions.length > 0,
      );
  }

  private getString(
    payload: Record<string, unknown> | unknown,
    key: string,
  ): string | null {
    if (!payload || typeof payload !== 'object') return null;
    const value = (payload as Record<string, unknown>)[key];
    return typeof value === 'string' && value.trim().length > 0
      ? value.trim()
      : null;
  }

  private getStringArray(
    payload: Record<string, unknown> | unknown,
    key: string,
  ): string[] {
    if (!payload || typeof payload !== 'object') return [];
    const value = (payload as Record<string, unknown>)[key];
    if (!Array.isArray(value)) return [];
    return value
      .filter((item) => typeof item === 'string')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  private parseJsonArray(value: string | null | undefined): string[] {
    try {
      const parsed = JSON.parse(value ?? '[]');
      return Array.isArray(parsed) ? parsed.map((v) => String(v)) : [];
    } catch {
      return [];
    }
  }

  private extractAttemptStatus(meta: unknown): string {
    if (!meta || typeof meta !== 'object') return 'unknown';
    const attempt = (meta as Record<string, unknown>).openAiAttempt;
    if (!attempt || typeof attempt !== 'object') return 'unknown';
    const status = (attempt as Record<string, unknown>).status;
    return typeof status === 'string' && status.length > 0
      ? status
      : 'unknown';
  }

  private newAttempt(): OpenAiAttempt {
    return {
      attempted: false,
      configuredModel: null,
      responseModel: null,
      latencyMs: null,
      status: null,
      httpStatus: null,
      errorMessage: null,
    };
  }

  private async saveTrace(input: {
    operation: 'audit_summary' | 'compare_summary' | 'rule_explain';
    source: 'heuristic' | 'openai';
    model: string | null;
    auditId: number | null;
    compareOldAudit: number | null;
    compareNewAudit: number | null;
    ruleId: string | null;
    latencyMs: number;
    success: boolean;
    errorMessage: string | null;
    requestMeta: Record<string, unknown>;
    responseMeta: Record<string, unknown>;
  }): Promise<number | null> {
    try {
      const created = await this.prisma.aiTrace.create({
        data: {
          ...input,
          requestMeta: input.requestMeta as Prisma.InputJsonValue,
          responseMeta: input.responseMeta as Prisma.InputJsonValue,
        },
      });
      return created.id;
    } catch (error: any) {
      this.logger.warn(`No se pudo guardar traza IA: ${error?.message ?? error}`);
      return null;
    }
  }

  private getConfiguredModel(): string {
    return (
      this.config.get<string>('OPENAI_MODEL') ??
      this.config.get<string>('AI_MODEL') ??
      'gpt-4o-mini'
    );
  }

  private getBaseUrl(): string {
    return (
      this.config.get<string>('OPENAI_BASE_URL') ?? 'https://api.openai.com/v1'
    ).replace(/\/$/, '');
  }

  private getOpenAiTimeoutMs(): number {
    const raw = this.config.get<string>('OPENAI_TIMEOUT_MS');
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 15000;
  }

  private logAiResolution(
    operation: string,
    source: AiSource,
    attempt: OpenAiAttempt,
    traceId: number | null,
  ) {
    if (source === 'openai') {
      this.logger.log(
        `AI ${operation}: source=openai model=${attempt.responseModel ?? attempt.configuredModel} traceId=${traceId ?? 'n/a'}`,
      );
      return;
    }
    this.logger.warn(
      `AI ${operation}: source=heuristic status=${attempt.status ?? 'n/a'} reason=${attempt.errorMessage ?? 'n/a'} traceId=${traceId ?? 'n/a'}`,
    );
  }
}
