import fs from 'node:fs/promises';
import type { StartupSessionPlanResponse } from '@hey-hey/ui-common/agents';
import { parseStartupSessionPlanResponseFromText } from '@hey-hey/ui-common/agents';

interface RunStartupPlanCommandOptions {
  filePath: string;
}

const truncate = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}...`;
};

const printStep = (
  step: StartupSessionPlanResponse['executionPlan'][number],
  index: number,
): void => {
  console.log(`${index + 1}. ${step.title}`);
  console.log(`   id: ${step.stepId}`);
  console.log(`   description: ${step.description}`);
  if (step.references.length > 0) {
    const refs = step.references.map((ref) => `${ref.sourceType}:${ref.sourceId}`).join(', ');
    console.log(`   references: ${refs}`);
  }
};

const printDiscrepancy = (
  discrepancy: StartupSessionPlanResponse['discrepancies'][number],
  index: number,
): void => {
  console.log(
    `${index + 1}. [${discrepancy.severity.toUpperCase()}] ${discrepancy.discrepancyText}`,
  );
  const source = `${discrepancy.sourceRef.sourceType}:${discrepancy.sourceRef.sourceId}${
    discrepancy.sourceField ? `.${discrepancy.sourceField}` : ''
  }`;
  console.log(`   source: ${source}`);
  console.log(`   excerpt: "${truncate(discrepancy.sourceExcerpt, 180)}"`);
  console.log(`   reasoning: ${truncate(discrepancy.reasoning, 220)}`);
};

const printQuestion = (
  question: StartupSessionPlanResponse['clarificationQuestions'][number],
  index: number,
): void => {
  console.log(`${index + 1}. ${question.question}`);
  if (question.reason) {
    console.log(`   reason: ${question.reason}`);
  }
  if (question.relatedSourceRefs && question.relatedSourceRefs.length > 0) {
    const related = question.relatedSourceRefs
      .map((ref) => `${ref.sourceType}:${ref.sourceId}`)
      .join(', ');
    console.log(`   related: ${related}`);
  }
};

const printStartupPlan = (plan: StartupSessionPlanResponse): void => {
  console.log('Startup plan loaded.');
  console.log(`Steps: ${plan.executionPlan.length}`);
  console.log(`Discrepancies: ${plan.discrepancies.length}`);
  console.log(`Clarification questions: ${plan.clarificationQuestions.length}`);

  console.log('\nExecution plan');
  if (plan.executionPlan.length === 0) {
    console.log('- none');
  } else {
    plan.executionPlan.forEach((step, index) => {
      printStep(step, index);
    });
  }

  console.log('\nDiscrepancies');
  if (plan.discrepancies.length === 0) {
    console.log('- none');
  } else {
    plan.discrepancies.forEach((discrepancy, index) => {
      printDiscrepancy(discrepancy, index);
    });
  }

  console.log('\nClarification questions');
  if (plan.clarificationQuestions.length === 0) {
    console.log('- none');
  } else {
    plan.clarificationQuestions.forEach((question, index) => {
      printQuestion(question, index);
    });
  }
};

export const runStartupPlanCommand = async ({
  filePath,
}: RunStartupPlanCommandOptions): Promise<boolean> => {
  console.log(`Loading startup plan from ${filePath}...`);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const result = parseStartupSessionPlanResponseFromText(raw);
    if (!result.ok) {
      console.error(`Could not parse startup plan: ${result.error}`);
      return false;
    }

    printStartupPlan(result.value);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to read file';
    console.error(`Could not load startup plan: ${message}`);
    return false;
  }
};
