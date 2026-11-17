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
