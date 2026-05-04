import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { AppModule } from './app.module';
import { AiModule } from './ai/ai.module';
import { AiAuditOptionsDto } from './ai/dto/ai-audit-options.dto';
import { AiCompareQueryDto } from './ai/dto/ai-compare-query.dto';
import { AiRuleExplainQueryDto } from './ai/dto/ai-rule-explain-query.dto';
import { AiTraceStatsDto } from './ai/dto/ai-trace-stats.dto';
import { ListAiTracesDto } from './ai/dto/list-ai-traces.dto';
import { AuditModule } from './audit/audit.module';
import { AuditDetailQueryDto } from './audit/dto/audit-detail-query.dto';
import { CompareAuditDto } from './audit/dto/compare-audit.dto';
import { CreateAuditDto } from './audit/dto/create-audit.dto';
import { ListAuditsDto } from './audit/dto/list-audits.dto';
import { UpdateAuditDto } from './audit/dto/update-audit.dto';
import { PrismaModule } from './prisma/prisma.module';
import { PrismaService } from './prisma/prisma.service';
import { WebsiteModule } from './website/website.module';

describe('Coverage smoke', () => {
  it('loads application modules', () => {
    expect(AppModule).toBeDefined();
    expect(AiModule).toBeDefined();
    expect(AuditModule).toBeDefined();
    expect(PrismaModule).toBeDefined();
    expect(WebsiteModule).toBeDefined();
  });

  it('validates AI DTOs with representative valid data', () => {
    const aiOptions = plainToInstance(AiAuditOptionsDto, {
      reuseOnly: true,
      forceHeuristic: false,
      maxRecommendations: 3,
      maxRules: 5,
    });
    const compare = plainToInstance(AiCompareQueryDto, {
      old: 1,
      new: 2,
      maxRecommendations: 2,
    });
    const explain = plainToInstance(AiRuleExplainQueryDto, {
      ruleType: 'incomplete',
      maxOccurrences: 4,
    });
    const stats = plainToInstance(AiTraceStatsDto, {
      operation: 'audit_summary',
      source: 'openai',
      sinceDays: 7,
    });
    const traces = plainToInstance(ListAiTracesDto, {
      limit: 50,
      operation: 'compare_summary',
      source: 'heuristic',
      auditId: 2,
    });

    expect(validateSync(aiOptions)).toHaveLength(0);
    expect(validateSync(compare)).toHaveLength(0);
    expect(validateSync(explain)).toHaveLength(0);
    expect(validateSync(stats)).toHaveLength(0);
    expect(validateSync(traces)).toHaveLength(0);
  });

  it('validates audit DTOs and catches representative invalid values', () => {
    const detail = plainToInstance(AuditDetailQueryDto, {
      occurrenceLimit: 10,
    });
    const compare = plainToInstance(CompareAuditDto, { old: 1, new: 2 });
    const create = plainToInstance(CreateAuditDto, {
      url: 'https://example.com',
    });
    const list = plainToInstance(ListAuditsDto, {
      page: 2,
      pageSize: 20,
      order: 'asc',
    });
    const update = plainToInstance(UpdateAuditDto, {
      status: 'completed',
      notes: 'ok',
    });
    const invalidUpdate = plainToInstance(UpdateAuditDto, {
      status: 'broken',
      notes: 'x'.repeat(2001),
    });

    expect(validateSync(detail)).toHaveLength(0);
    expect(validateSync(compare)).toHaveLength(0);
    expect(validateSync(create)).toHaveLength(0);
    expect(validateSync(list)).toHaveLength(0);
    expect(validateSync(update)).toHaveLength(0);
    expect(validateSync(invalidUpdate)).toHaveLength(2);
  });

  it('connects and disconnects PrismaService through lifecycle hooks', async () => {
    const connect = jest
      .spyOn(PrismaService.prototype, '$connect')
      .mockResolvedValue(undefined);
    const disconnect = jest
      .spyOn(PrismaService.prototype, '$disconnect')
      .mockResolvedValue(undefined);

    const prisma = Object.create(PrismaService.prototype) as PrismaService;

    await prisma.onModuleInit();
    await prisma.onModuleDestroy();

    expect(connect).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
