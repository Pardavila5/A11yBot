import { BadRequestException } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';

describe('AiController', () => {
  let controller: AiController;
  let aiService: {
    getAuditSummary: jest.Mock;
    getAuditSummaryAB: jest.Mock;
    explainRuleInAudit: jest.Mock;
    getComparisonSummary: jest.Mock;
    getComparisonSummaryAB: jest.Mock;
    listTraces: jest.Mock;
    getTraceStats: jest.Mock;
  };

  beforeEach(() => {
    aiService = {
      getAuditSummary: jest.fn().mockResolvedValue({ source: 'heuristic' }),
      getAuditSummaryAB: jest
        .fn()
        .mockResolvedValue({ operation: 'audit_summary' }),
      explainRuleInAudit: jest
        .fn()
        .mockResolvedValue({ rule: { ruleId: 'image-alt' } }),
      getComparisonSummary: jest.fn().mockResolvedValue({ source: 'openai' }),
      getComparisonSummaryAB: jest
        .fn()
        .mockResolvedValue({ operation: 'compare_summary' }),
      listTraces: jest.fn().mockResolvedValue({ total: 0, items: [] }),
      getTraceStats: jest.fn().mockResolvedValue({ window: { total: 0 } }),
    };

    controller = new AiController(aiService as unknown as AiService);
  });

  it('delegates audit summary, rule explanation and trace endpoints', async () => {
    const summary = await controller.getAuditSummary(7, {
      forceHeuristic: true,
      maxRecommendations: 2,
    });
    const summaryAb = await controller.getAuditSummaryAB(7);
    const explanation = await controller.explainRule(7, 'image-alt', {
      ruleType: 'violations',
      maxOccurrences: 3,
    });
    const traces = await controller.getTraces({
      limit: 10,
      source: 'heuristic',
    });
    const stats = await controller.getTraceStats({ sinceDays: 7 });

    expect(aiService.getAuditSummary).toHaveBeenCalledWith(7, {
      forceHeuristic: true,
      maxRecommendations: 2,
    });
    expect(aiService.getAuditSummaryAB).toHaveBeenCalledWith(7);
    expect(aiService.explainRuleInAudit).toHaveBeenCalledWith(7, 'image-alt', {
      ruleType: 'violations',
      maxOccurrences: 3,
    });
    expect(aiService.listTraces).toHaveBeenCalledWith({
      limit: 10,
      source: 'heuristic',
    });
    expect(aiService.getTraceStats).toHaveBeenCalledWith({ sinceDays: 7 });
    expect(summary).toEqual({ source: 'heuristic' });
    expect(summaryAb).toEqual({ operation: 'audit_summary' });
    expect(explanation).toEqual({ rule: { ruleId: 'image-alt' } });
    expect(traces).toEqual({ total: 0, items: [] });
    expect(stats).toEqual({ window: { total: 0 } });
  });

  it('delegates comparisons and rejects self-comparisons', async () => {
    await expect(
      controller.compareAudits({ old: 5, new: 5 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.compareAuditsAB({ old: 9, new: 9 }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const result = await controller.compareAudits({
      old: 1,
      new: 2,
      maxRecommendations: 3,
    });
    const abResult = await controller.compareAuditsAB({ old: 1, new: 2 });

    expect(aiService.getComparisonSummary).toHaveBeenCalledWith(1, 2, {
      old: 1,
      new: 2,
      maxRecommendations: 3,
    });
    expect(aiService.getComparisonSummaryAB).toHaveBeenCalledWith(1, 2);
    expect(result).toEqual({ source: 'openai' });
    expect(abResult).toEqual({ operation: 'compare_summary' });
  });
});
