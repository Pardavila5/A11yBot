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

type AiRuleType = 'violations' | 'passes' | 'incomplete';

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

type AiResolution = {
  attempted: boolean;
  status: string | null;
  usedFallback: boolean;
  reason: string | null;
  latencyMs: number | null;
};

type AuditSummaryArtifact = {
  generatedAt: string;
  source: AiSource;
  model: string | null;
  resolution: AiResolution;
  executiveSummary: string;
  technicalSummary: string;
  recommendations: AiRecommendation[];
  topViolations: TopViolation[];
};

type CompareSummaryArtifact = {
  generatedAt: string;
  source: AiSource;
  model: string | null;
  resolution: AiResolution;
  executiveSummary: string;
  technicalSummary: string;
  recommendations: AiRecommendation[];
};

type RuleExplanationArtifact = {
  generatedAt: string;
  source: AiSource;
  model: string | null;
  resolution: AiResolution;
  explanation: {
    summary: string;
    whyItMatters: string;
    fixes: string[];
    testChecklist: string[];
  };
};

type AuditSummaryInput = {
  auditId: number;
  url: string;
  violationRules: number;
  incompleteRules: number;
  totalRules: number;
  occurrences: number;
  prioritizedRuleIds: string[];
  topViolations: TopViolation[];
};

type CompareSummaryInput = {
  oldId: number;
  newId: number;
  summary: {
    newViolationRules: number;
    resolvedViolationRules: number;
    persistentViolationRules: number;
  };
};

type RuleExplanationSample = {
  target: string[];
  failureSummary: string | null;
  htmlSnippet: string;
};

type RuleExplanationInput = {
  auditId: number;
  ruleId: string;
  ruleType: AiRuleType;
  impact: string | null;
  description: string;
  help: string;
  helpUrl: string;
  wcag: string[];
  occurrences: number;
  samples: RuleExplanationSample[];
};

type OpenAiChatCompletionResponse = {
  model?: string;
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

type AiTraceWhere = {
  operation?: 'audit_summary' | 'compare_summary' | 'rule_explain';
  source?: 'openai' | 'heuristic';
  createdAt?: {
    gte: Date;
  };
};

const AB_MAX_RECOMMENDATIONS = 3;
const AB_MAX_RULES = 5;

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
    const where = {
      operation: query.operation,
      source: query.source,
      auditId: query.auditId,
    };

    const [total, items] = await Promise.all([
      this.prisma.aiTrace.count({ where }),
      this.prisma.aiTrace.findMany({
        select: {
          id: true,
          createdAt: true,
          operation: true,
          source: true,
          model: true,
          auditId: true,
          compareOldAudit: true,
          compareNewAudit: true,
          ruleId: true,
          latencyMs: true,
          success: true,
          errorMessage: true,
        },
        take: limit,
        where,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return { total, items };
  }

  async getTraceStats(query: AiTraceStatsDto) {
    const where: AiTraceWhere = {
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
      this.getAuditSummary(auditId, {
        forceHeuristic: true,
        maxRecommendations: AB_MAX_RECOMMENDATIONS,
        maxRules: AB_MAX_RULES,
      }),
      this.getAuditSummary(auditId, {
        forceHeuristic: false,
        maxRecommendations: AB_MAX_RECOMMENDATIONS,
        maxRules: AB_MAX_RULES,
      }),
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
        fallbackTriggered: assisted.resolution.usedFallback,
        assistedStatus: assisted.resolution.status,
      },
    };
  }

  async getComparisonSummaryAB(oldId: number, newId: number) {
    const [heuristic, assisted] = await Promise.all([
      this.getComparisonSummary(oldId, newId, {
        forceHeuristic: true,
        maxRecommendations: AB_MAX_RECOMMENDATIONS,
      }),
      this.getComparisonSummary(oldId, newId, {
        forceHeuristic: false,
        maxRecommendations: AB_MAX_RECOMMENDATIONS,
      }),
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
        fallbackTriggered: assisted.resolution.usedFallback,
        assistedStatus: assisted.resolution.status,
      },
    };
  }

  async getAuditSummary(auditId: number, options: AiAuditOptionsDto) {
    this.logger.log(
      `AI audit_summary request: auditId=${auditId} forceHeuristic=${options.forceHeuristic === true}`,
    );

    const audit = await this.prisma.audit.findUnique({
      where: { id: auditId },
      include: { website: true, rules: true, occurrences: true },
    });
    if (!audit) {
      throw new NotFoundException(`No existe auditoría con ID ${auditId}`);
    }

    const violations = audit.rules.filter((r) => r.type === 'violations');
    const topViolationLimit = options.maxRules ?? AB_MAX_RULES;
    const cached = await this.findReusableAuditSummaryTrace(
      auditId,
      options.forceHeuristic === true,
    );
    if (cached) {
      this.logger.log(
        `AI audit_summary reuse: auditId=${auditId} traceId=${cached.traceId}`,
      );
      return {
        traceId: cached.traceId,
        source: cached.artifact.source,
        generatedAt: cached.artifact.generatedAt,
        model: cached.artifact.model,
        resolution: cached.artifact.resolution,
        audit: {
          id: audit.id,
          url: audit.website.url,
          timestamp: audit.timestamp,
          status: audit.status ?? null,
        },
        metrics: {
          rules: {
            total: audit.rules.length,
            violations: violations.length,
            passes: audit.rules.filter((r) => r.type === 'passes').length,
            incomplete: audit.rules.filter((r) => r.type === 'incomplete')
              .length,
          },
          occurrences: audit.occurrences.length,
          topViolations: cached.artifact.topViolations.slice(
            0,
            topViolationLimit,
          ),
        },
        executiveSummary: cached.artifact.executiveSummary,
        technicalSummary: cached.artifact.technicalSummary,
        recommendations: this.limitRecommendations(
          cached.artifact.recommendations,
          options.maxRecommendations,
        ),
      };
    }
    if (options.reuseOnly) {
      throw new NotFoundException(
        `No existe resumen IA persistido para la auditoría ${auditId}`,
      );
    }

    const startedAt = Date.now();
    const attempt = this.newAttempt();
    const topViolations = this.getTopViolations(
      violations,
      audit.occurrences,
      topViolationLimit,
    );
    const ruleIdsForSummary =
      topViolations.length > 0
        ? topViolations.map((item) => item.ruleId)
        : violations.map((r) => r.ruleId);
    const heuristic = this.heuristicAudit(
      audit.website.url,
      violations.length,
      audit.rules.filter((r) => r.type === 'incomplete').length,
      audit.occurrences.length,
      topViolations,
    );

    let source: AiSource = 'heuristic';
    let model: string | null = null;
    let executiveSummary = heuristic.executiveSummary;
    let technicalSummary = heuristic.technicalSummary;
    let fullRecommendations = heuristic.recommendations;

    if (options.forceHeuristic) {
      attempt.status = 'forced_heuristic';
      attempt.errorMessage = 'forceHeuristic=true';
    } else {
      const ai = await this.generateOpenAiAuditSummary(
        {
          auditId,
          url: audit.website.url,
          violationRules: violations.length,
          incompleteRules: audit.rules.filter((r) => r.type === 'incomplete')
            .length,
          totalRules: audit.rules.length,
          occurrences: audit.occurrences.length,
          prioritizedRuleIds: ruleIdsForSummary,
          topViolations,
        },
        attempt,
      );

      if (ai) {
        source = 'openai';
        model = ai.model;
        executiveSummary = ai.executiveSummary;
        technicalSummary = ai.technicalSummary;
        fullRecommendations =
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

    const resolution = this.buildResolution(source, attempt);
    const artifact: AuditSummaryArtifact = {
      generatedAt: new Date().toISOString(),
      source,
      model,
      resolution,
      executiveSummary,
      technicalSummary,
      recommendations: fullRecommendations,
      topViolations,
    };

    const recommendations = this.limitRecommendations(
      artifact.recommendations,
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
      success: this.isTraceSuccessful(source, attempt),
      errorMessage: attempt.errorMessage,
      requestMeta: {
        forceHeuristic: options.forceHeuristic ?? false,
        maxRecommendations: options.maxRecommendations ?? null,
        maxRules: topViolationLimit,
      },
      responseMeta: {
        openAiAttempt: attempt,
        recommendations: recommendations.length,
        artifactVersion: 1,
        artifact,
      },
    });

    this.logAiResolution('audit_summary', source, attempt, traceId);

    return {
      traceId,
      source: artifact.source,
      generatedAt: artifact.generatedAt,
      model: artifact.model,
      resolution,
      audit: {
        id: audit.id,
        url: audit.website.url,
        timestamp: audit.timestamp,
        status: audit.status ?? null,
      },
      metrics: {
        rules: {
          total: audit.rules.length,
          violations: violations.length,
          passes: audit.rules.filter((r) => r.type === 'passes').length,
          incomplete: audit.rules.filter((r) => r.type === 'incomplete').length,
        },
        occurrences: audit.occurrences.length,
        topViolations: artifact.topViolations,
      },
      executiveSummary: artifact.executiveSummary,
      technicalSummary: artifact.technicalSummary,
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

    const compare = await this.auditService.compareAudits(oldId, newId);
    const cached = await this.findReusableCompareSummaryTrace(
      oldId,
      newId,
      options.forceHeuristic === true,
    );
    if (cached) {
      this.logger.log(
        `AI compare_summary reuse: oldId=${oldId} newId=${newId} traceId=${cached.traceId}`,
      );
      return {
        traceId: cached.traceId,
        source: cached.artifact.source,
        generatedAt: cached.artifact.generatedAt,
        model: cached.artifact.model,
        resolution: cached.artifact.resolution,
        audits: compare.audits,
        summary: compare.summary,
        executiveSummary: cached.artifact.executiveSummary,
        technicalSummary: cached.artifact.technicalSummary,
        recommendations: this.limitRecommendations(
          cached.artifact.recommendations,
          options.maxRecommendations,
        ),
      };
    }

    const startedAt = Date.now();
    const attempt = this.newAttempt();
    const heuristic = this.heuristicCompare(
      compare.summary.newViolationRules,
      compare.summary.resolvedViolationRules,
      compare.summary.persistentViolationRules,
    );

    let source: AiSource = 'heuristic';
    let model: string | null = null;
    let executiveSummary = heuristic.executiveSummary;
    let technicalSummary = heuristic.technicalSummary;
    let fullRecommendations = heuristic.recommendations;

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
        fullRecommendations =
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

    const resolution = this.buildResolution(source, attempt);
    const artifact: CompareSummaryArtifact = {
      generatedAt: new Date().toISOString(),
      source,
      model,
      resolution,
      executiveSummary,
      technicalSummary,
      recommendations: fullRecommendations,
    };

    const recommendations = this.limitRecommendations(
      artifact.recommendations,
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
      success: this.isTraceSuccessful(source, attempt),
      errorMessage: attempt.errorMessage,
      requestMeta: {
        forceHeuristic: options.forceHeuristic ?? false,
        maxRecommendations: options.maxRecommendations ?? null,
      },
      responseMeta: {
        openAiAttempt: attempt,
        recommendations: recommendations.length,
        artifactVersion: 1,
        artifact,
      },
    });

    this.logAiResolution('compare_summary', source, attempt, traceId);

    return {
      traceId,
      source: artifact.source,
      generatedAt: artifact.generatedAt,
      model: artifact.model,
      resolution,
      audits: compare.audits,
      summary: compare.summary,
      executiveSummary: artifact.executiveSummary,
      technicalSummary: artifact.technicalSummary,
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

    const requestedRuleType = this.normalizeRuleType(options.ruleType);
    const rule =
      audit.rules.find(
        (r) =>
          r.ruleId === ruleId &&
          this.normalizeRuleType(r.type) === requestedRuleType,
      ) ??
      audit.rules.find((r) => r.ruleId === ruleId) ??
      null;
    if (!rule) {
      throw new NotFoundException(
        `La regla ${ruleId} no existe en la auditoría ${auditId}`,
      );
    }

    const matchingOccurrences = audit.occurrences.filter(
      (o) => o.ruleRef === rule.id,
    );
    const samples = matchingOccurrences
      .slice(0, options.maxOccurrences ?? 3)
      .map((occurrence) => ({
        target: this.parseJsonArray(occurrence.target),
        failureSummary: occurrence.failureSummary ?? null,
        htmlSnippet: occurrence.htmlSnippet,
      }));

    const fallback = this.buildRuleExplanationFallback(
      rule.ruleId,
      this.normalizeRuleType(rule.type),
      rule.impact ?? null,
      matchingOccurrences.length,
    );

    const cached = await this.findReusableRuleExplainTrace(
      auditId,
      rule.ruleId,
      this.normalizeRuleType(rule.type),
    );
    if (cached) {
      this.logger.log(
        `AI rule_explain reuse: auditId=${auditId} ruleId=${rule.ruleId} traceId=${cached.traceId}`,
      );
      return {
        traceId: cached.traceId,
        source: cached.artifact.source,
        generatedAt: cached.artifact.generatedAt,
        model: cached.artifact.model,
        resolution: cached.artifact.resolution,
        audit: {
          id: audit.id,
          url: audit.website.url,
          timestamp: audit.timestamp.toISOString(),
          status: audit.status ?? null,
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
        explanation: cached.artifact.explanation,
      };
    }
    if (options.reuseOnly) {
      throw new NotFoundException(
        `No existe explicación IA persistida para la regla ${rule.ruleId} en la auditoría ${auditId}`,
      );
    }

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
          ruleType: this.normalizeRuleType(rule.type),
          impact: rule.impact ?? null,
          description: rule.description,
          help: rule.help,
          helpUrl: rule.helpUrl,
          wcag: this.parseJsonArray(rule.wcag),
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

    const resolution = this.buildResolution(source, attempt);
    const artifact: RuleExplanationArtifact = {
      generatedAt: new Date().toISOString(),
      source,
      model,
      resolution,
      explanation,
    };

    const traceId = await this.saveTrace({
      operation: 'rule_explain',
      source,
      model: model ?? attempt.responseModel ?? attempt.configuredModel,
      auditId,
      compareOldAudit: null,
      compareNewAudit: null,
      ruleId,
      latencyMs: Date.now() - startedAt,
      success: this.isTraceSuccessful(source, attempt),
      errorMessage: attempt.errorMessage,
      requestMeta: {
        forceHeuristic: options.forceHeuristic ?? false,
        maxOccurrences: options.maxOccurrences ?? null,
        ruleType: this.normalizeRuleType(rule.type),
      },
      responseMeta: { openAiAttempt: attempt, artifactVersion: 1, artifact },
    });

    this.logAiResolution('rule_explain', source, attempt, traceId);

    return {
      traceId,
      source: artifact.source,
      generatedAt: artifact.generatedAt,
      model: artifact.model,
      resolution,
      audit: {
        id: audit.id,
        url: audit.website.url,
        timestamp: audit.timestamp.toISOString(),
        status: audit.status ?? null,
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
      explanation: artifact.explanation,
    };
  }

  private heuristicAudit(
    url: string,
    violations: number,
    incomplete: number,
    occurrences: number,
    topViolations: TopViolation[],
  ) {
    const executiveSummary =
      incomplete > 0
        ? `En ${url} se detectaron ${violations} reglas en violación, ${incomplete} reglas en revisión manual y ${occurrences} ocurrencias.`
        : `En ${url} se detectaron ${violations} reglas en violación y ${occurrences} ocurrencias.`;
    const technicalSummary =
      topViolations.length > 0
        ? incomplete > 0
          ? `Prioriza: ${topViolations.map((item) => item.ruleId).join(', ')}. Además, revisa manualmente las reglas incomplete antes de cerrar la auditoría.`
          : `Prioriza: ${topViolations.map((item) => item.ruleId).join(', ')}.`
        : incomplete > 0
          ? 'No hay reglas críticas para priorizar, pero quedan comprobaciones incomplete que requieren revisión manual.'
          : 'No hay reglas críticas para priorizar.';
    const recommendations: AiRecommendation[] = topViolations
      .slice(0, 3)
      .map((item) => ({
        title: `Corregir ${item.ruleId}`,
        reason: `Regla prioritaria por impacto/recurrencia (ocurrencias: ${item.occurrences}).`,
        actions: [
          'Aplicar fix en componente base',
          'Verificar con teclado',
          'Reauditar',
        ],
        priority: item.score >= 8 ? 'high' : item.score >= 4 ? 'medium' : 'low',
        ruleId: item.ruleId,
      }));

    if (incomplete > 0) {
      recommendations.push({
        title: 'Revisar resultados incomplete',
        reason: `La automatización ha dejado ${incomplete} reglas en revisión manual.`,
        actions: [
          'Validar manualmente los casos señalados',
          'Confirmar contraste, foco o nombre accesible según la regla',
          'Documentar criterio y reauditar',
        ],
        priority: violations > 0 ? 'medium' : 'high',
      });
    }

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

  private heuristicCompare(
    newRules: number,
    resolved: number,
    persistent: number,
  ) {
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
        if (b.occurrences !== a.occurrences)
          return b.occurrences - a.occurrences;
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

  private async generateOpenAiAuditSummary(
    input: AuditSummaryInput,
    attempt: OpenAiAttempt,
  ) {
    const payload = await this.requestOpenAiJson(
      "Devuelve SOLO un objeto JSON sin markdown, en espanol de Espana, con estas claves exactas: executiveSummary (string), technicalSummary (string) y recommendations (array de objetos con title, reason, actions, priority y ruleId opcional). Usa terminologia precisa: 'reglas en violacion' para el numero de reglas, 'reglas incomplete' o 'reglas en revision manual' para los hallazgos no concluyentes y 'ocurrencias' para el numero de instancias. No digas que hay N violaciones si N corresponde a ocurrencias. Si hay reglas incomplete, menciónalas explícitamente y recomienda revisión manual; no las presentes como fallo confirmado.",
      input,
      attempt,
    );
    if (!payload) return null;

    const executiveSummary = this.getStringByAliases(payload, [
      'executiveSummary',
      'executive_summary',
      'executive',
      'summary',
      'resumenEjecutivo',
    ]);
    const technicalSummary = this.getStringByAliases(payload, [
      'technicalSummary',
      'technical_summary',
      'technical',
      'details',
      'analysis',
      'resumenTecnico',
    ]);
    const recommendations = this.getRecommendationsByAliases(payload);

    if (!executiveSummary || !technicalSummary) {
      attempt.status = 'invalid_payload';
      attempt.errorMessage = `Missing fields: executiveSummary=${!!executiveSummary} technicalSummary=${!!technicalSummary}`;
      this.logger.warn(
        `OpenAI audit_summary invalid_payload: executive=${!!executiveSummary} technical=${!!technicalSummary} keys=${Object.keys(payload).join(',').slice(0, 160)}`,
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
    input: CompareSummaryInput,
    attempt: OpenAiAttempt,
  ) {
    const payload = await this.requestOpenAiJson(
      'Devuelve SOLO un objeto JSON sin markdown, en espanol de Espana, con estas claves exactas: executiveSummary (string), technicalSummary (string) y recommendations (array de objetos con title, reason, actions, priority y ruleId opcional). Distingue con precision entre nuevas, resueltas y persistentes.',
      input,
      attempt,
    );
    if (!payload) return null;

    const executiveSummary = this.getStringByAliases(payload, [
      'executiveSummary',
      'executive_summary',
      'executive',
      'summary',
      'resumenEjecutivo',
    ]);
    const technicalSummary = this.getStringByAliases(payload, [
      'technicalSummary',
      'technical_summary',
      'technical',
      'details',
      'analysis',
      'resumenTecnico',
    ]);
    const recommendations = this.getRecommendationsByAliases(payload);

    if (!executiveSummary || !technicalSummary) {
      attempt.status = 'invalid_payload';
      attempt.errorMessage = `Missing fields: executiveSummary=${!!executiveSummary} technicalSummary=${!!technicalSummary}`;
      this.logger.warn(
        `OpenAI compare_summary invalid_payload: executive=${!!executiveSummary} technical=${!!technicalSummary} keys=${Object.keys(payload).join(',').slice(0, 160)}`,
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
    input: RuleExplanationInput,
    attempt: OpenAiAttempt,
  ) {
    const payload = await this.requestOpenAiJson(
      this.getRuleExplanationPrompt(input.ruleType),
      input,
      attempt,
    );
    if (!payload) return null;

    const summary = this.getStringByAliases(payload, [
      'summary',
      'executiveSummary',
      'executive_summary',
    ]);
    const whyItMatters = this.getStringByAliases(payload, [
      'whyItMatters',
      'why_it_matters',
      'rationale',
      'impactSummary',
    ]);
    const fixes = this.getStringArrayByAliases(payload, [
      'fixes',
      'actions',
      'recommendations',
    ]);
    const testChecklist = this.getStringArrayByAliases(payload, [
      'testChecklist',
      'test_checklist',
      'checks',
      'validationSteps',
    ]);

    if (!summary || !whyItMatters) {
      attempt.status = 'invalid_payload';
      attempt.errorMessage = `Missing fields: summary=${!!summary} whyItMatters=${!!whyItMatters}`;
      this.logger.warn(
        `OpenAI rule_explain invalid_payload: summary=${!!summary} whyItMatters=${!!whyItMatters} keys=${Object.keys(payload).join(',').slice(0, 160)}`,
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
            : ['Revisar patrón base.', 'Validar cambio.', 'Reauditar.'],
        testChecklist:
          testChecklist.length > 0
            ? testChecklist
            : ['Navegación por teclado', 'Lector de pantalla', 'Reauditoría'],
      },
    };
  }

  private getRuleExplanationPrompt(ruleType: AiRuleType): string {
    if (ruleType === 'passes') {
      return 'Devuelve SOLO un objeto JSON sin markdown, en espanol de Espana, con estas claves exactas: summary (string), whyItMatters (string), fixes (array de strings) y testChecklist (array de strings). La regla ya ha PASADO; explica por que el resultado es correcto, que patron accesible valida y como mantenerlo sin regresiones. No redactes como si hubiera un fallo.';
    }
    if (ruleType === 'incomplete') {
      return 'Devuelve SOLO un objeto JSON sin markdown, en espanol de Espana, con estas claves exactas: summary (string), whyItMatters (string), fixes (array de strings) y testChecklist (array de strings). La regla esta en estado INCOMPLETE; explica que la automatizacion no puede concluir el resultado, que debe revisarse manualmente y como validar el caso. No afirmes ni fallo ni cumplimiento. Prioriza acciones de validacion manual; no presentes cambios de diseño o eliminación de fondos como solución obligatoria salvo que el input lo justifique claramente.';
    }
    return 'Devuelve SOLO un objeto JSON sin markdown, en espanol de Espana, con estas claves exactas: summary (string), whyItMatters (string), fixes (array de strings) y testChecklist (array de strings). La regla esta en violacion; explica el problema, su impacto y pasos concretos de correccion.';
  }

  private buildRuleExplanationFallback(
    ruleId: string,
    ruleType: AiRuleType,
    impact: string | null,
    occurrences: number,
  ) {
    if (ruleType === 'passes') {
      return {
        summary: `La regla ${ruleId} se ha validado correctamente en ${occurrences} ocurrencias revisadas.`,
        whyItMatters:
          'Confirma que este patrón ya cumple la comprobación automática y conviene preservarlo para evitar regresiones.',
        fixes: [
          'Mantener este patrón en componentes similares.',
          'Revisar cambios visuales o semánticos relacionados.',
          'Reauditar tras modificaciones relevantes.',
        ],
        testChecklist: [
          'Revisar que el patrón siga presente',
          'Validar con teclado o lector de pantalla si aplica',
          'Reauditoría',
        ],
      };
    }

    if (ruleType === 'incomplete') {
      return {
        summary: `La regla ${ruleId} requiere revisión manual; la automatización no puede concluir el resultado en ${occurrences} casos.`,
        whyItMatters:
          'Un resultado incomplete no implica ni fallo ni cumplimiento, pero sí una zona de riesgo que debe validarse manualmente.',
        fixes: [
          'Revisar manualmente los casos señalados.',
          'Validar con tecnologías asistivas o teclado.',
          'Documentar criterio y reauditar.',
        ],
        testChecklist: [
          'Inspección manual del caso',
          'Prueba con lector de pantalla o teclado',
          'Reauditoría',
        ],
      };
    }

    return {
      summary: `La regla ${ruleId} requiere corrección priorizada en ${occurrences} ocurrencias.`,
      whyItMatters: `Impacto estimado: ${impact ?? 'n/a'}.`,
      fixes: [
        'Corregir componente base.',
        'Validar navegación por teclado.',
        'Reauditar.',
      ],
      testChecklist: [
        'Navegación por teclado',
        'Lector de pantalla',
        'Reauditoría',
      ],
    };
  }

  private normalizeRuleType(value: string | null | undefined): AiRuleType {
    if (value === 'passes') return 'passes';
    if (value === 'incomplete') return 'incomplete';
    return 'violations';
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

      const data = (await res.json()) as OpenAiChatCompletionResponse;
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
      this.logger.log(
        `OpenAI OK [${attempt.responseModel}] ${attempt.latencyMs}ms`,
      );
      return { ...parsed, _model: attempt.responseModel };
    } catch (error: unknown) {
      const isAbort = error instanceof Error && error.name === 'AbortError';
      attempt.status = isAbort ? 'timeout' : 'exception';
      attempt.errorMessage = isAbort
        ? `Timeout tras ${timeoutMs}ms`
        : this.getErrorMessage(error).slice(0, 200);
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
      const parsed: unknown = JSON.parse(value);
      return this.asRecord(parsed);
    } catch {
      return null;
    }
  }

  private getRecommendationsByAliases(
    payload: Record<string, unknown>,
  ): AiRecommendation[] {
    for (const candidate of this.getPayloadCandidates(payload)) {
      const recommendations = this.getRecommendations(candidate);
      if (recommendations.length > 0) {
        return recommendations;
      }
    }
    return [];
  }

  private getRecommendations(
    payload: Record<string, unknown>,
  ): AiRecommendation[] {
    const raw =
      payload.recommendations ?? payload.recommendationList ?? payload.items;
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
        priority: this.normalizePriority(this.getString(entry, 'priority')),
        ruleId: this.getString(entry, 'ruleId') ?? undefined,
      }))
      .filter(
        (entry) =>
          entry.title.length > 0 &&
          entry.reason.length > 0 &&
          entry.actions.length > 0,
      );
  }

  private normalizePriority(
    value: string | null | undefined,
  ): 'high' | 'medium' | 'low' {
    const normalized = value?.trim().toLowerCase();
    if (!normalized) return 'medium';
    if (
      ['high', 'alta', 'alto', 'critical', 'critica', 'crítica'].includes(
        normalized,
      )
    ) {
      return 'high';
    }
    if (
      ['medium', 'media', 'medio', 'moderate', 'moderada'].includes(normalized)
    ) {
      return 'medium';
    }
    if (['low', 'baja', 'bajo', 'minor'].includes(normalized)) {
      return 'low';
    }
    return 'medium';
  }

  private getStringByAliases(
    payload: Record<string, unknown>,
    aliases: string[],
  ): string | null {
    for (const candidate of this.getPayloadCandidates(payload)) {
      for (const alias of aliases) {
        const value = this.getString(candidate, alias);
        if (value) return value;
      }
    }
    return null;
  }

  private getStringArrayByAliases(
    payload: Record<string, unknown>,
    aliases: string[],
  ): string[] {
    for (const candidate of this.getPayloadCandidates(payload)) {
      for (const alias of aliases) {
        const value = this.getStringArray(candidate, alias);
        if (value.length > 0) return value;
      }
    }
    return [];
  }

  private getPayloadCandidates(
    payload: Record<string, unknown>,
  ): Record<string, unknown>[] {
    const candidates: Record<string, unknown>[] = [];
    const seen = new Set<Record<string, unknown>>();

    const pushCandidate = (value: unknown) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return;
      const objectValue = value as Record<string, unknown>;
      if (seen.has(objectValue)) return;
      seen.add(objectValue);
      candidates.push(objectValue);
    };

    pushCandidate(payload);

    for (const candidate of [...candidates]) {
      for (const key of [
        'data',
        'result',
        'output',
        'summary',
        'response',
        'payload',
      ]) {
        pushCandidate(candidate[key]);
      }
    }

    return candidates;
  }

  private getString(payload: unknown, key: string): string | null {
    if (!payload || typeof payload !== 'object') return null;
    const value = (payload as Record<string, unknown>)[key];
    return typeof value === 'string' && value.trim().length > 0
      ? value.trim()
      : null;
  }

  private getStringArray(payload: unknown, key: string): string[] {
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
      const parsed: unknown = JSON.parse(value ?? '[]');
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
    return typeof status === 'string' && status.length > 0 ? status : 'unknown';
  }

  private async findReusableAuditSummaryTrace(
    auditId: number,
    forceHeuristic: boolean,
  ): Promise<{ traceId: number; artifact: AuditSummaryArtifact } | null> {
    const items = await this.prisma.aiTrace.findMany({
      where: { operation: 'audit_summary', auditId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    for (const item of items) {
      const requestMeta = this.asRecord(item.requestMeta);
      if (!requestMeta) continue;
      if (this.asBoolean(requestMeta.forceHeuristic) !== forceHeuristic)
        continue;
      const artifact = this.parseAuditSummaryArtifact(item.responseMeta);
      if (!artifact) continue;
      return { traceId: item.id, artifact };
    }

    return null;
  }

  private async findReusableCompareSummaryTrace(
    oldId: number,
    newId: number,
    forceHeuristic: boolean,
  ): Promise<{ traceId: number; artifact: CompareSummaryArtifact } | null> {
    const items = await this.prisma.aiTrace.findMany({
      where: {
        operation: 'compare_summary',
        compareOldAudit: oldId,
        compareNewAudit: newId,
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    for (const item of items) {
      const requestMeta = this.asRecord(item.requestMeta);
      if (!requestMeta) continue;
      if (this.asBoolean(requestMeta.forceHeuristic) !== forceHeuristic)
        continue;
      const artifact = this.parseCompareSummaryArtifact(item.responseMeta);
      if (!artifact) continue;
      return { traceId: item.id, artifact };
    }

    return null;
  }

  private parseAuditSummaryArtifact(
    meta: unknown,
  ): AuditSummaryArtifact | null {
    const responseMeta = this.asRecord(meta);
    if (!responseMeta || responseMeta.artifactVersion !== 1) return null;
    const artifact = this.asRecord(responseMeta.artifact);
    if (!artifact) return null;

    const executiveSummary = this.getString(artifact, 'executiveSummary');
    const technicalSummary = this.getString(artifact, 'technicalSummary');
    const generatedAt = this.getString(artifact, 'generatedAt');
    if (!executiveSummary || !technicalSummary || !generatedAt) return null;

    const topViolations = this.parseTopViolations(artifact.topViolations);
    return {
      generatedAt,
      source: this.parseAiSource(artifact.source),
      model: this.getString(artifact, 'model'),
      resolution: this.parseResolution(artifact.resolution),
      executiveSummary,
      technicalSummary,
      recommendations: this.getRecommendations(artifact),
      topViolations,
    };
  }

  private parseCompareSummaryArtifact(
    meta: unknown,
  ): CompareSummaryArtifact | null {
    const responseMeta = this.asRecord(meta);
    if (!responseMeta || responseMeta.artifactVersion !== 1) return null;
    const artifact = this.asRecord(responseMeta.artifact);
    if (!artifact) return null;

    const executiveSummary = this.getString(artifact, 'executiveSummary');
    const technicalSummary = this.getString(artifact, 'technicalSummary');
    const generatedAt = this.getString(artifact, 'generatedAt');
    if (!executiveSummary || !technicalSummary || !generatedAt) return null;

    return {
      generatedAt,
      source: this.parseAiSource(artifact.source),
      model: this.getString(artifact, 'model'),
      resolution: this.parseResolution(artifact.resolution),
      executiveSummary,
      technicalSummary,
      recommendations: this.getRecommendations(artifact),
    };
  }

  private async findReusableRuleExplainTrace(
    auditId: number,
    ruleId: string,
    ruleType: AiRuleType,
  ): Promise<{ traceId: number; artifact: RuleExplanationArtifact } | null> {
    const items = await this.prisma.aiTrace.findMany({
      where: { operation: 'rule_explain', auditId, ruleId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    for (const item of items) {
      const requestMeta = this.asRecord(item.requestMeta);
      if (!requestMeta) continue;
      if (
        (this.getString(requestMeta, 'ruleType') ?? 'violations') !== ruleType
      )
        continue;
      const artifact = this.parseRuleExplanationArtifact(item.responseMeta);
      if (!artifact) continue;
      return { traceId: item.id, artifact };
    }

    return null;
  }

  private parseRuleExplanationArtifact(
    meta: unknown,
  ): RuleExplanationArtifact | null {
    const responseMeta = this.asRecord(meta);
    if (!responseMeta || responseMeta.artifactVersion !== 1) return null;
    const artifact = this.asRecord(responseMeta.artifact);
    if (!artifact) return null;

    const generatedAt = this.getString(artifact, 'generatedAt');
    const explanation = this.asRecord(artifact.explanation);
    if (!generatedAt || !explanation) return null;

    const summary = this.getString(explanation, 'summary');
    const whyItMatters = this.getString(explanation, 'whyItMatters');
    if (!summary || !whyItMatters) return null;

    return {
      generatedAt,
      source: this.parseAiSource(artifact.source),
      model: this.getString(artifact, 'model'),
      resolution: this.parseResolution(artifact.resolution),
      explanation: {
        summary,
        whyItMatters,
        fixes: this.getStringArray(explanation, 'fixes'),
        testChecklist: this.getStringArray(explanation, 'testChecklist'),
      },
    };
  }

  private parseTopViolations(value: unknown): TopViolation[] {
    if (!Array.isArray(value)) return [];
    return value
      .filter(
        (entry): entry is Record<string, unknown> =>
          !!entry && typeof entry === 'object',
      )
      .map((entry) => {
        const ruleId = this.getString(entry, 'ruleId');
        const occurrences = this.asNumber(entry.occurrences);
        const score = this.asNumber(entry.score);
        if (!ruleId || occurrences === null || score === null) return null;
        return {
          ruleId,
          impact: this.getString(entry, 'impact'),
          occurrences,
          score,
        };
      })
      .filter((entry): entry is TopViolation => entry !== null);
  }

  private parseResolution(value: unknown): AiResolution {
    const record = this.asRecord(value);
    if (!record) {
      return {
        attempted: false,
        status: null,
        usedFallback: false,
        reason: null,
        latencyMs: null,
      };
    }

    return {
      attempted: this.asBoolean(record.attempted),
      status: this.getString(record, 'status'),
      usedFallback: this.asBoolean(record.usedFallback),
      reason: this.getString(record, 'reason'),
      latencyMs: this.asNumber(record.latencyMs),
    };
  }

  private parseAiSource(value: unknown): AiSource {
    return value === 'openai' ? 'openai' : 'heuristic';
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private asBoolean(value: unknown): boolean {
    return value === true;
  }

  private asNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
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

  private buildResolution(
    source: AiSource,
    attempt: OpenAiAttempt,
  ): AiResolution {
    return {
      attempted: attempt.attempted,
      status: attempt.status,
      usedFallback: attempt.attempted && source !== 'openai',
      reason: attempt.errorMessage,
      latencyMs: attempt.latencyMs,
    };
  }

  private isTraceSuccessful(source: AiSource, attempt: OpenAiAttempt): boolean {
    if (!attempt.attempted) {
      return true;
    }
    if (source === 'openai') {
      return attempt.status === 'success';
    }
    return attempt.status === 'forced_heuristic';
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
    } catch (error: unknown) {
      this.logger.warn(
        `No se pudo guardar traza IA: ${this.getErrorMessage(error)}`,
      );
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

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }
}
