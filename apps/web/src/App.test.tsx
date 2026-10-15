// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, expect, it } from 'vitest';
import { App } from './App';

beforeAll(() => {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }) as unknown as MediaQueryList;
});

afterEach(cleanup);

it('renders the shell and routes to a page', () => {
  render(
    <MemoryRouter initialEntries={['/resumes']}>
      <App />
    </MemoryRouter>,
  );
  expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'My Resumes' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'My Resumes' })).toHaveAttribute('aria-current', 'page');
});
