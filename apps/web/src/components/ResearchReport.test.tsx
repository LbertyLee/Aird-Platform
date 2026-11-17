// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import ResearchReport from './ResearchReport';

afterEach(cleanup);
it('renders the actual research answer as Markdown rather than an object string', () => {
  render(
    <ResearchReport
      result={
        {
          runId: 'r',
          query: 'Research',
          answer: '**Evidence-based conclusion**',
          sources: [],
          mode: 'mixed',
        } as never
      }
      busy={false}
      onSource={vi.fn()}
    />,
  );
  expect(screen.getByText('Evidence-based conclusion').tagName).toBe('STRONG');
  expect(screen.queryByText('[object Object]')).toBeNull();
});

it('does not present raw API JSON as the report conclusion', () => {
  render(
    <ResearchReport
      result={
        {
          runId: 'r',
          query: 'GDP growth',
          answer:
            '[E1] {"country":"China","indicatorCode":"NY.GDP.MKTP.CD","year":2024,"value":123}',
          sources: [],
          mode: 'mixed',
        } as never
      }
      analysis={
        {
          createdAt: new Date().toISOString(),
          observations: [],
          summary: [
            {
              key: 'china-2024',
              entity: '中国',
              period: '2024',
              indicatorName: 'GDP实际增速',
              value: 5,
              unit: '%',
              sourceCount: 1,
              observationCount: 1,
              conflict: false,
              sourceIds: [],
            },
          ],
          sources: [],
          availableIndicators: [],
          warnings: [],
        } as never
      }
      busy={false}
      onSource={vi.fn()}
    />,
  );
  expect(screen.getByText(/中国 2024 GDP实际增速：5 %/)).toBeTruthy();
  expect(screen.queryByText(/NY\.GDP\.MKTP\.CD/)).toBeNull();
});
