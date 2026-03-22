import { describe, it, expect } from 'vitest';
import { computeReport } from '../src/evaluator.js';
import type { EvalResult } from '../src/config.js';

function makeResult(overrides: Partial<EvalResult> & { modelId: string }): EvalResult {
  return {
    prompt: { text: 'test prompt', type: 'positive' },
    response: 'test response',
    trigger: { triggered: true, correct: true, reason: 'ok' },
    ...overrides,
  };
}

describe('computeReport', () => {
  it('computes perfect score for all correct results', () => {
    const results: EvalResult[] = [
      makeResult({
        modelId: 'model-a',
        trigger: { triggered: true, correct: true, reason: 'ok' },
        compliance: { compliant: true, score: 100, reason: 'ok' },
      }),
      makeResult({
        modelId: 'model-a',
        prompt: { text: 'neg', type: 'negative' },
        trigger: { triggered: false, correct: true, reason: 'ok' },
      }),
    ];
    const [report] = computeReport(results, ['model-a']);
    expect(report.triggerScore.correct).toBe(2);
    expect(report.triggerScore.total).toBe(2);
    expect(report.complianceScore.correct).toBe(1);
    expect(report.complianceScore.total).toBe(1);
    expect(report.overall).toBe(100);
  });

  it('computes zero score for all incorrect results', () => {
    const results: EvalResult[] = [
      makeResult({
        modelId: 'model-a',
        trigger: { triggered: false, correct: false, reason: 'fail' },
      }),
      makeResult({
        modelId: 'model-a',
        prompt: { text: 'neg', type: 'negative' },
        trigger: { triggered: true, correct: false, reason: 'fail' },
      }),
    ];
    const [report] = computeReport(results, ['model-a']);
    expect(report.triggerScore.correct).toBe(0);
    expect(report.overall).toBe(0);
  });

  it('sorts models by overall score descending', () => {
    const results: EvalResult[] = [
      makeResult({
        modelId: 'model-low',
        trigger: { triggered: false, correct: false, reason: 'fail' },
      }),
      makeResult({
        modelId: 'model-high',
        trigger: { triggered: true, correct: true, reason: 'ok' },
        compliance: { compliant: true, score: 100, reason: 'ok' },
      }),
    ];
    const reports = computeReport(results, ['model-low', 'model-high']);
    expect(reports[0].modelId).toBe('model-high');
    expect(reports[1].modelId).toBe('model-low');
  });

  it('handles models with no compliance results', () => {
    const results: EvalResult[] = [
      makeResult({
        modelId: 'model-a',
        prompt: { text: 'neg', type: 'negative' },
        trigger: { triggered: false, correct: true, reason: 'ok' },
      }),
    ];
    const [report] = computeReport(results, ['model-a']);
    expect(report.complianceScore.total).toBe(0);
    expect(report.complianceScore.avgScore).toBe(0);
    expect(report.overall).toBe(50); // 100% trigger * 50
  });

  it('handles multiple models independently', () => {
    const results: EvalResult[] = [
      makeResult({
        modelId: 'model-a',
        trigger: { triggered: true, correct: true, reason: 'ok' },
        compliance: { compliant: true, score: 80, reason: 'ok' },
      }),
      makeResult({
        modelId: 'model-b',
        trigger: { triggered: false, correct: false, reason: 'fail' },
      }),
    ];
    const reports = computeReport(results, ['model-a', 'model-b']);
    const reportA = reports.find(r => r.modelId === 'model-a')!;
    const reportB = reports.find(r => r.modelId === 'model-b')!;
    expect(reportA.overall).toBeGreaterThan(reportB.overall);
  });
});
