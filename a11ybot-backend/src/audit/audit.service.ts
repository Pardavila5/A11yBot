import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AxeBuilder } from '@axe-core/playwright';
import { Browser, BrowserContext, Page, chromium } from 'playwright';
import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';
import { AxeAuditResult } from '../common/interfaces/axe-result.interface';
import {
  NormalizedOccurrence,
  NormalizedRule,
} from '../common/interfaces/normalized-result.interface';
import { PrismaService } from '../prisma/prisma.service';

type QueueItem = { host: string; resolve: () => void };

type SerializedViolation = {
  ruleId: string;
  impact: string | null;
  description: string;
  help: string;
  helpUrl: string;
  wcag: string[];
  type: 'violations';
  occurrences: {
    id: number;
    htmlSnippet: string;
    target: string[];
    failureSummary: string | null;
  }[];
};

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  private readonly defaultTimeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly maxConcurrentGlobal: number;
  private readonly maxConcurrentPerHost: number;
  private readonly allowPrivateTargets: boolean;

  private activeAudits = 0;
  private readonly activeByHost = new Map<string, number>();
  private readonly pendingQueue: QueueItem[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.defaultTimeoutMs = this.getPositiveInt('AUDIT_TIMEOUT_MS', 10000);
    this.maxRetries = this.getPositiveInt('AUDIT_MAX_RETRIES', 1);
    this.retryDelayMs = this.getPositiveInt('AUDIT_RETRY_DELAY_MS', 500);
    this.maxConcurrentGlobal = this.getPositiveInt('AUDIT_MAX_CONCURRENT', 2);
    this.maxConcurrentPerHost = this.getPositiveInt(
      'AUDIT_MAX_CONCURRENT_PER_HOST',
      1,
    );
    this.allowPrivateTargets =
      this.config.get<string>('ALLOW_PRIVATE_TARGETS') === 'true';
  }

  async runAudit(rawUrl: string): Promise<AxeAuditResult> {
    this.logger.log(`audit.start url=${rawUrl}`);

    let browser: Browser | null = null;
    let context: BrowserContext | null = null;
    let page: Page | null = null;
    let auditId: number | null = null;
    let host: string | null = null;
    let slotAcquired = false;

    try {
      const parsedUrl = await this.validateAndNormalizeUrl(rawUrl);
      const normalizedUrl = parsedUrl.toString();
      host = parsedUrl.host.toLowerCase();

      await this.acquireSlot(host);
      slotAcquired = true;

      ({ auditId } = await this.createRunningAudit(normalizedUrl));

      browser = await chromium.launch({ headless: true });
      context = await browser.newContext();
      page = await context.newPage();

      const { axeResults, attemptsUsed } = await this.executeAuditWithRetries(
        page,
        normalizedUrl,
      );

      const { rules, occurrences } = this.normalize(axeResults);
      const timestamp = new Date();

      await this.saveAuditResults(
        auditId,
        timestamp,
        axeResults,
        rules,
        occurrences,
      );

      this.logger.log(
        `audit.completed auditId=${auditId} host=${host} attempts=${attemptsUsed} rules=${rules.length} occurrences=${occurrences.length}`,
      );

      return {
        url: normalizedUrl,
        timestamp: timestamp.toISOString(),
        rules,
        occurrences,
      };
    } catch (error: any) {
      if (auditId) {
        await this.markAuditFailed(auditId, error?.message ?? 'unknown error');
      }

      const message = error?.message ?? String(error);
      this.logger.error(`audit.failed url=${rawUrl} reason="${message}"`);

      if (message.includes('Timeout')) {
        throw new BadRequestException(
          'La página tardó demasiado en responder (timeout).',
        );
      }
      if (message.includes('net::ERR_NAME_NOT_RESOLVED')) {
        throw new BadRequestException(
          'No se pudo acceder a la URL (dominio inexistente).',
        );
      }
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Ocurrió un error inesperado durante la auditoría.',
      );
    } finally {
      await page?.close().catch(() => undefined);
      await context?.close().catch(() => undefined);
      await browser?.close().catch(() => undefined);

      if (slotAcquired && host) {
        this.releaseSlot(host);
      }

      this.logger.log(`audit.cleanup url=${rawUrl}`);
    }
  }

  async compareAudits(oldId: number, newId: number) {
    const [oldAudit, newAudit] = await Promise.all([
      this.prisma.audit.findUnique({
        where: { id: oldId },
        include: {
          website: true,
          rules: { where: { type: 'violations' } },
          occurrences: { include: { rule: true } },
        },
      }),
      this.prisma.audit.findUnique({
        where: { id: newId },
        include: {
          website: true,
          rules: { where: { type: 'violations' } },
          occurrences: { include: { rule: true } },
        },
      }),
    ]);

    if (!oldAudit) {
      throw new BadRequestException(`No existe auditoría con ID ${oldId}`);
    }
    if (!newAudit) {
      throw new BadRequestException(`No existe auditoría con ID ${newId}`);
    }

    const oldHost = new URL(oldAudit.website.url).host;
    const newHost = new URL(newAudit.website.url).host;
    if (oldHost !== newHost) {
      throw new BadRequestException(
        'Solo se pueden comparar auditorías del mismo dominio.',
      );
    }

    const oldSnapshot = this.extractViolationSnapshot(oldAudit);
    const newSnapshot = this.extractViolationSnapshot(newAudit);

    const newViolations: SerializedViolation[] = [];
    const resolvedViolations: SerializedViolation[] = [];
    const persistentViolations: SerializedViolation[] = [];

    for (const [key, value] of newSnapshot.entries()) {
      if (!oldSnapshot.has(key)) {
        newViolations.push(this.serializeViolation(value));
      } else {
        persistentViolations.push(this.serializeViolation(value));
      }
    }

    for (const [key, value] of oldSnapshot.entries()) {
      if (!newSnapshot.has(key)) {
        resolvedViolations.push(this.serializeViolation(value));
      }
    }

    const summary = {
      totalViolationRulesOld: oldSnapshot.size,
      totalViolationRulesNew: newSnapshot.size,
      totalOccurrencesOld: this.countOccurrences(oldSnapshot),
      totalOccurrencesNew: this.countOccurrences(newSnapshot),
      deltaViolationRules: newSnapshot.size - oldSnapshot.size,
      newViolationRules: newViolations.length,
      resolvedViolationRules: resolvedViolations.length,
      persistentViolationRules: persistentViolations.length,
    };

    return {
      audits: {
        old: {
          id: oldAudit.id,
          url: oldAudit.website.url,
          timestamp: oldAudit.timestamp,
        },
        new: {
          id: newAudit.id,
          url: newAudit.website.url,
          timestamp: newAudit.timestamp,
        },
      },
      summary,
      newViolations,
      resolvedViolations,
      persistentViolations,
    };
  }

  async getAuditRuntimeStats() {
    return {
      activeAudits: this.activeAudits,
      activeByHost: Object.fromEntries(this.activeByHost.entries()),
      queued: this.pendingQueue.length,
      limits: {
        global: this.maxConcurrentGlobal,
        perHost: this.maxConcurrentPerHost,
      },
      timeoutMs: this.defaultTimeoutMs,
      retries: this.maxRetries,
      retryDelayMs: this.retryDelayMs,
      allowPrivateTargets: this.allowPrivateTargets,
    };
  }

  private async createRunningAudit(url: string): Promise<{ auditId: number }> {
    return this.prisma.$transaction(async (tx) => {
      const website = await tx.website.upsert({
        where: { url },
        update: {},
        create: { url },
      });

      const audit = await tx.audit.create({
        data: {
          websiteId: website.id,
          timestamp: new Date(),
          rawJson: {},
          status: 'running',
          notes: null,
        },
      });

      return { auditId: audit.id };
    });
  }

  private async markAuditFailed(auditId: number, message: string) {
    await this.prisma.audit.update({
      where: { id: auditId },
      data: {
        status: 'failed',
        notes: message.slice(0, 500),
      },
    });
  }

  private async saveAuditResults(
    auditId: number,
    timestamp: Date,
    rawResults: any,
    rules: NormalizedRule[],
    occurrences: NormalizedOccurrence[],
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.audit.update({
        where: { id: auditId },
        data: {
          rawJson: rawResults,
          timestamp,
          status: 'completed',
          notes: null,
        },
      });

      const ruleIdMap = new Map<string, number>();
      for (const rule of rules) {
        const createdRule = await tx.rule.create({
          data: {
            auditId,
            ruleId: rule.ruleId,
            impact: rule.impact ?? null,
            description: rule.description,
            help: rule.help,
            helpUrl: rule.helpUrl,
            wcag: JSON.stringify(rule.wcag),
            type: rule.type,
          },
        });
        ruleIdMap.set(this.buildRuleKey(rule.ruleId, rule.type), createdRule.id);
      }

      for (const occ of occurrences) {
        const key = this.buildRuleKey(occ.ruleId, occ.type);
        const ruleDbId = ruleIdMap.get(key);
        if (!ruleDbId) {
          this.logger.warn(
            `audit.save.missing_rule ruleId=${occ.ruleId} type=${occ.type}`,
          );
          continue;
        }

        await tx.occurrence.create({
          data: {
            auditId,
            ruleRef: ruleDbId,
            htmlSnippet: occ.htmlSnippet,
            target: JSON.stringify(occ.target),
            failureSummary: occ.failureSummary ?? null,
          },
        });
      }
    });
  }

  private async executeAuditWithRetries(page: Page, url: string): Promise<{
    axeResults: any;
    attemptsUsed: number;
  }> {
    const totalAttempts = this.maxRetries + 1;
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
      const start = Date.now();
      try {
        await page.goto(url, {
          waitUntil: 'networkidle',
          timeout: this.defaultTimeoutMs,
        });
        const axeResults = await new AxeBuilder({ page }).analyze();
        const elapsed = Date.now() - start;
        this.logger.log(
          `audit.attempt.ok url=${url} attempt=${attempt}/${totalAttempts} elapsedMs=${elapsed}`,
        );
        return { axeResults, attemptsUsed: attempt };
      } catch (error: any) {
        lastError = error;
        const elapsed = Date.now() - start;
        const retryable = this.isRetryableAuditError(error);
        this.logger.warn(
          `audit.attempt.fail url=${url} attempt=${attempt}/${totalAttempts} retryable=${retryable} elapsedMs=${elapsed} reason="${error?.message ?? error}"`,
        );

        if (!retryable || attempt >= totalAttempts) {
          throw error;
        }

        await this.sleep(this.retryDelayMs * attempt);
      }
    }

    throw lastError;
  }

  private isRetryableAuditError(error: unknown): boolean {
    const message = String((error as any)?.message ?? error).toLowerCase();
    return (
      message.includes('timeout') ||
      message.includes('net::err_') ||
      message.includes('connection') ||
      message.includes('econnreset') ||
      message.includes('etimedout')
    );
  }

  private async validateAndNormalizeUrl(rawUrl: string): Promise<URL> {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new BadRequestException(
        'La URL proporcionada no es válida o no tiene un formato correcto.',
      );
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new BadRequestException(
        'Solo se permiten URLs con protocolo http o https.',
      );
    }
    if (parsed.username || parsed.password) {
      throw new BadRequestException(
        'La URL no puede incluir usuario o contraseña.',
      );
    }

    if (this.allowPrivateTargets) {
      return parsed;
    }

    const hostname = parsed.hostname.toLowerCase();
    if (this.isBlockedHostname(hostname)) {
      throw new BadRequestException(
        'La URL apunta a una red/localización no permitida por seguridad.',
      );
    }

    let resolved: Array<{ address: string }> = [];
    try {
      resolved = await dns.lookup(hostname, { all: true, verbatim: true });
    } catch {
      throw new BadRequestException(
        'No se pudo resolver el dominio de la URL proporcionada.',
      );
    }

    if (resolved.length === 0) {
      throw new BadRequestException(
        'No se pudo resolver el dominio de la URL proporcionada.',
      );
    }

    const blockedAddress = resolved.find((entry) =>
      this.isPrivateOrReservedIp(entry.address),
    );
    if (blockedAddress) {
      throw new BadRequestException(
        'La URL resuelve a una IP privada/no enrutable y se bloqueó por seguridad.',
      );
    }

    return parsed;
  }

  private isBlockedHostname(hostname: string): boolean {
    if (hostname === 'localhost') return true;
    if (hostname.endsWith('.localhost')) return true;
    if (hostname.endsWith('.local')) return true;
    if (hostname.endsWith('.internal')) return true;
    return this.isPrivateOrReservedIp(hostname);
  }

  private isPrivateOrReservedIp(value: string): boolean {
    const version = isIP(value);
    if (version === 0) return false;

    if (version === 4) {
      const [a, b] = value.split('.').map((part) => Number(part));
      if (a === 10) return true;
      if (a === 127) return true;
      if (a === 0) return true;
      if (a === 169 && b === 254) return true;
      if (a === 172 && b >= 16 && b <= 31) return true;
      if (a === 192 && b === 168) return true;
      if (a === 100 && b >= 64 && b <= 127) return true;
      if (a === 198 && (b === 18 || b === 19)) return true;
      if (a >= 224) return true;
      return false;
    }

    const ip = value.toLowerCase();
    if (ip === '::' || ip === '::1') return true;
    if (ip.startsWith('fc') || ip.startsWith('fd')) return true;
    if (ip.startsWith('fe80')) return true;
    if (ip.startsWith('fec0')) return true;
    return false;
  }

  private async acquireSlot(host: string): Promise<void> {
    if (this.canStartHost(host)) {
      this.reserveSlot(host);
      return;
    }

    await new Promise<void>((resolve) => {
      this.pendingQueue.push({ host, resolve });
    });
  }

  private releaseSlot(host: string) {
    this.activeAudits = Math.max(0, this.activeAudits - 1);
    const currentHost = this.activeByHost.get(host) ?? 0;
    if (currentHost <= 1) {
      this.activeByHost.delete(host);
    } else {
      this.activeByHost.set(host, currentHost - 1);
    }
    this.drainQueue();
  }

  private drainQueue() {
    let progressed = true;
    while (progressed && this.pendingQueue.length > 0) {
      progressed = false;
      for (let index = 0; index < this.pendingQueue.length; index += 1) {
        const item = this.pendingQueue[index];
        if (!this.canStartHost(item.host)) continue;
        this.pendingQueue.splice(index, 1);
        this.reserveSlot(item.host);
        item.resolve();
        progressed = true;
        break;
      }
    }
  }

  private canStartHost(host: string): boolean {
    return (
      this.activeAudits < this.maxConcurrentGlobal &&
      (this.activeByHost.get(host) ?? 0) < this.maxConcurrentPerHost
    );
  }

  private reserveSlot(host: string) {
    this.activeAudits += 1;
    this.activeByHost.set(host, (this.activeByHost.get(host) ?? 0) + 1);
  }

  private getPositiveInt(key: string, fallback: number): number {
    const raw = this.config.get<string>(key);
    const value = raw ? Number(raw) : NaN;
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private buildRuleKey(ruleId: string, type: NormalizedRule['type']): string {
    return `${ruleId}::${type}`;
  }

  private normalize(results: any): {
    rules: NormalizedRule[];
    occurrences: NormalizedOccurrence[];
  } {
    const rules: NormalizedRule[] = [];
    const occurrences: NormalizedOccurrence[] = [];
    const seenRuleKeys = new Set<string>();

    const types = ['violations', 'passes', 'incomplete'] as const;
    for (const type of types) {
      for (const rule of results[type] || []) {
        const ruleId = rule.id;
        const ruleKey = this.buildRuleKey(ruleId, type);
        const wcagTags =
          rule.tags?.filter((tag: string) => tag.startsWith('wcag')) ?? [];

        if (!seenRuleKeys.has(ruleKey)) {
          rules.push({
            ruleId,
            impact: rule.impact ?? null,
            description: rule.description,
            help: rule.help,
            helpUrl: rule.helpUrl,
            wcag: wcagTags,
            type,
          });
          seenRuleKeys.add(ruleKey);
        }

        for (const node of rule.nodes || []) {
          occurrences.push({
            ruleId,
            type,
            htmlSnippet: node.html,
            target: node.target,
            failureSummary: node.failureSummary ?? null,
          });
        }
      }
    }

    return { rules, occurrences };
  }

  private extractViolationSnapshot(
    audit: any,
  ): Map<string, { rule: any; occurrences: any[] }> {
    const occurrencesByRule = new Map<number, any[]>();
    for (const occurrence of audit.occurrences || []) {
      if (occurrence.rule?.type !== 'violations') continue;
      const existing = occurrencesByRule.get(occurrence.ruleRef) ?? [];
      existing.push(occurrence);
      occurrencesByRule.set(occurrence.ruleRef, existing);
    }

    const snapshot = new Map<string, { rule: any; occurrences: any[] }>();
    for (const rule of audit.rules || []) {
      if (rule.type !== 'violations') continue;
      const key = this.buildRuleKey(rule.ruleId, rule.type);
      snapshot.set(key, {
        rule,
        occurrences: occurrencesByRule.get(rule.id) ?? [],
      });
    }

    return snapshot;
  }

  private serializeViolation(value: {
    rule: any;
    occurrences: any[];
  }): SerializedViolation {
    const { rule, occurrences } = value;
    return {
      ruleId: rule.ruleId,
      impact: rule.impact ?? null,
      description: rule.description,
      help: rule.help,
      helpUrl: rule.helpUrl,
      wcag: JSON.parse(rule.wcag ?? '[]'),
      type: 'violations',
      occurrences: occurrences.map((occurrence) => ({
        id: occurrence.id,
        htmlSnippet: occurrence.htmlSnippet,
        target: JSON.parse(occurrence.target ?? '[]'),
        failureSummary: occurrence.failureSummary ?? null,
      })),
    };
  }

  private countOccurrences(
    snapshot: Map<string, { rule: any; occurrences: any[] }>,
  ): number {
    let count = 0;
    for (const value of snapshot.values()) {
      count += value.occurrences.length;
    }
    return count;
  }
}
