import { useState, type ReactNode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';

/**
 * A data router for tests, so components that use useBlocker work. The app mounts under a single
 * splat route, exactly as main.tsx does.
 */
export function TestRouter({ path = '/', children }: { path?: string; children: ReactNode }) {
  const [router] = useState(() =>
    createMemoryRouter([{ path: '*', element: children }], { initialEntries: [path] }),
  );
  return <RouterProvider router={router} />;
}
