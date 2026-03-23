import chalk from 'chalk';
import type { EvalReport, EvalResult, SkillEvalSummary } from './config.js';

function padRight(str: string, len: number): string {
  return str.length >= len ? str.slice(0, len) : str + ' '.repeat(len - str.length);
}

function scoreColor(score: number): (text: string) => string {
  if (score >= 70) return chalk.green;
  if (score >= 40) return chalk.yellow;
  return chalk.red;
}

function printTable(reports: EvalReport[]): void {
  const modelWidth = Math.max(20, ...reports.map(r => r.modelId.length)) + 2;
  const triggerWidth = 14;
  const complianceWidth = 16;
  const overallWidth = 9;

  const line = (left: string, mid: string, right: string, fill: string) =>
    left + fill.repeat(modelWidth) + mid + fill.repeat(triggerWidth) + mid + fill.repeat(complianceWidth) + mid + fill.repeat(overallWidth) + right;

  console.log(line('┌', '┬', '┐', '─'));
  console.log(
    '│' + padRight(' Model', modelWidth) +
    '│' + padRight(' Trigger', triggerWidth) +
    '│' + padRight(' Compliance', complianceWidth) +
    '│' + padRight(' Overall', overallWidth) + '│',
  );
  console.log(line('├', '┼', '┤', '─'));

  for (const report of reports) {
    const triggerStr = `${report.triggerScore.correct}/${report.triggerScore.total}`;
    const complianceStr = report.complianceScore.total > 0
      ? `${report.complianceScore.correct}/${report.complianceScore.total} (${report.complianceScore.avgScore})`
      : 'N/A';
    const overallStr = `${report.overall}%`;
    const color = scoreColor(report.overall);

    console.log(
      '│' + padRight(` ${report.modelId}`, modelWidth) +
      '│' + padRight(` ${triggerStr}`, triggerWidth) +
      '│' + padRight(` ${complianceStr}`, complianceWidth) +
      '│' + color(padRight(` ${overallStr}`, overallWidth)) + '│',
    );
  }

  console.log(line('└', '┴', '┘', '─'));

  if (reports.length > 0) {
    const best = reports[0];
    const worst = reports[reports.length - 1];
    console.log(`\n${chalk.green('Best model:')} ${best.modelId} (${best.overall}%)`);
    if (reports.length > 1) {
      console.log(`${chalk.red('Worst model:')} ${worst.modelId} (${worst.overall}%)`);
    }
  }
}

function printVerbose(evalResults: EvalResult[]): void {
  const byModel = new Map<string, EvalResult[]>();
  for (const result of evalResults) {
    const arr = byModel.get(result.modelId) ?? [];
    arr.push(result);
    byModel.set(result.modelId, arr);
  }

  for (const [modelId, results] of byModel) {
    console.log(`\n${chalk.bold(`--- ${modelId} ---`)}`);
    for (const result of results) {
      const status = result.trigger.correct ? chalk.green('PASS') : chalk.red('FAIL');
      console.log(`  [${status}] ${result.prompt.type}: "${result.prompt.text.slice(0, 60)}"`);
      console.log(`         ${result.trigger.reason}`);
      if (result.compliance) {
        const compStatus = result.compliance.compliant ? chalk.green('PASS') : chalk.red('FAIL');
        console.log(`    Compliance: [${compStatus}] ${result.compliance.score}/100 — ${result.compliance.reason}`);
      }
    }
  }
}

function printComparisonSummary(summaries: SkillEvalSummary[]): void {
  if (summaries.length < 2) return;

  console.log(`\n${chalk.bold('━━━ Comparison Summary ━━━')}`);

  // Collect all model IDs across all skills
  const allModelIds = [...new Set(summaries.flatMap(s => s.reports.map(r => r.modelId)))];
  const skillNames = summaries.map(s => s.skill.name);
  const skillWidth = Math.max(20, ...skillNames.map(n => n.length)) + 2;
  const colWidth = 10;

  // Header
  let header = '│' + padRight(' Model', skillWidth);
  for (const name of skillNames) {
    header += '│' + padRight(` ${name.slice(0, colWidth - 2)}`, colWidth);
  }
  header += '│';

  const totalWidth = skillWidth + allModelIds.length + skillNames.length * colWidth;
  const topLine = '┌' + '─'.repeat(skillWidth) + skillNames.map(() => '┬' + '─'.repeat(colWidth)).join('') + '┐';
  const midLine = '├' + '─'.repeat(skillWidth) + skillNames.map(() => '┼' + '─'.repeat(colWidth)).join('') + '┤';
  const botLine = '└' + '─'.repeat(skillWidth) + skillNames.map(() => '┴' + '─'.repeat(colWidth)).join('') + '┘';

  console.log(topLine);
  console.log(header);
  console.log(midLine);

  for (const modelId of allModelIds) {
    let row = '│' + padRight(` ${modelId}`, skillWidth);
    for (const summary of summaries) {
      const report = summary.reports.find(r => r.modelId === modelId);
      if (report) {
        const color = scoreColor(report.overall);
        row += '│' + color(padRight(` ${report.overall}%`, colWidth));
      } else {
        row += '│' + padRight(' N/A', colWidth);
      }
    }
    row += '│';
    console.log(row);
  }

  // Average row
  console.log(midLine);
  let avgRow = '│' + padRight(' Avg', skillWidth);
  for (const summary of summaries) {
    const avg = summary.reports.length > 0
      ? Math.round(summary.reports.reduce((sum, r) => sum + r.overall, 0) / summary.reports.length)
      : 0;
    const color = scoreColor(avg);
    avgRow += '│' + color(padRight(` ${avg}%`, colWidth));
  }
  avgRow += '│';
  console.log(avgRow);
  console.log(botLine);

  // Winner
  const avgScores = summaries.map(s => ({
    name: s.skill.name,
    avg: s.reports.length > 0
      ? Math.round(s.reports.reduce((sum, r) => sum + r.overall, 0) / s.reports.length)
      : 0,
  }));
  const winner = avgScores.reduce((best, cur) => cur.avg > best.avg ? cur : best);
  console.log(`\n${chalk.green('Best performing skill:')} ${winner.name} (avg ${winner.avg}%)`);
  void totalWidth;
}

export function printReport(
  summaries: SkillEvalSummary[],
  options: { json: boolean; verbose: boolean },
): void {
  if (options.json) {
    console.log(JSON.stringify(
      summaries.map(s => ({ skill: s.skill.name, reports: s.reports, evalResults: s.evalResults })),
      null,
      2,
    ));
    return;
  }

  for (const summary of summaries) {
    if (summaries.length > 1) {
      console.log(`\n${chalk.bold(`══ Skill: ${summary.skill.name} ══`)}`);
      console.log(`${chalk.dim(summary.skill.description)}\n`);
    }

    printTable(summary.reports);

    if (options.verbose) {
      printVerbose(summary.evalResults);
    }
  }

  if (summaries.length > 1) {
    printComparisonSummary(summaries);
  } else if (!options.verbose) {
    console.log(`\nRun with ${chalk.cyan('--verbose')} to see individual test results.`);
    console.log(`Run with ${chalk.cyan('--json')} to get machine-readable output.`);
  }
}
