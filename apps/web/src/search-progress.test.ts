import { expect, it } from 'vitest';
import { buildSearchWorkflowSteps } from './search-progress';

const initial = {
  status: 'running' as const,
  stage: 'planning' as const,
  hasResult: false,
  creatingAnalysis: false,
  hasReport: false,
};
const states = (input: Parameters<typeof buildSearchWorkflowSteps>[0]) =>
  buildSearchWorkflowSteps(input).map((step) => step.state);

it('starts at intent and keeps later steps pending', () => {
  expect(states(initial)).toEqual([
    'active',
    'pending',
    'pending',
    'pending',
    'pending',
  ]);
});

it.each([
  'searching',
  'discovering',
  'evaluating',
  'writing',
  'replanning',
] as const)(
  'keeps %s within retrieval rather than claiming analysis',
  (stage) => {
    expect(states({ ...initial, stage })).toEqual([
      'done',
      'active',
      'pending',
      'pending',
      'pending',
    ]);
  },
);

it('search completion does not claim analysis or report completion', () => {
  expect(states({ ...initial, status: 'done', hasResult: true })).toEqual([
    'done',
    'done',
    'pending',
    'pending',
    'pending',
  ]);
});

it('marks only the actual interrupted stage', () => {
  expect(states({ ...initial, status: 'error' })).toEqual([
    'interrupted',
    'pending',
    'pending',
    'pending',
    'pending',
  ]);
  expect(
    states({ ...initial, stage: 'writing', status: 'error', hasResult: true }),
  ).toEqual(['done', 'interrupted', 'pending', 'pending', 'pending']);
});

it('waits for analysis and report evidence separately', () => {
  const done = { ...initial, status: 'done' as const, hasResult: true };
  expect(states({ ...done, creatingAnalysis: true })).toEqual([
    'done',
    'done',
    'active',
    'pending',
    'pending',
  ]);
  expect(states({ ...done, analysisStatus: 'partial' })).toEqual([
    'done',
    'done',
    'pending',
    'pending',
    'pending',
  ]);
  expect(states({ ...done, analysisStatus: 'ready' })).toEqual([
    'done',
    'done',
    'done',
    'done',
    'pending',
  ]);
  expect(states({ ...done, analysisStatus: 'ready', hasReport: true })).toEqual(
    ['done', 'done', 'done', 'done', 'done'],
  );
  expect(
    states({
      ...done,
      creatingAnalysis: true,
      analysisStatus: 'ready',
      hasReport: true,
    }),
  ).toEqual(['done', 'done', 'active', 'pending', 'pending']);
});
