// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { Button, Input, Stepper, Tabs, TabsContent, TabsList, TabsTrigger } from '.';

afterEach(cleanup);

describe('Input', () => {
  it('links label, hint and error for assistive tech', () => {
    render(<Input label="Email" hint="We never share it" error="Required" />);
    const input = screen.getByLabelText('Email');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Required We never share it');
  });
});

describe('Button', () => {
  it('is disabled and busy while loading', () => {
    render(<Button loading>Save</Button>);
    const btn = screen.getByRole('button', { name: 'Save' });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
  });
});

describe('Tabs', () => {
  it('exposes tablist semantics and switches with the keyboard', async () => {
    const user = userEvent.setup();
    render(
      <Tabs defaultValue="a">
        <TabsList aria-label="Sections">
          <TabsTrigger value="a">A</TabsTrigger>
          <TabsTrigger value="b">B</TabsTrigger>
        </TabsList>
        <TabsContent value="a">Panel A</TabsContent>
        <TabsContent value="b">Panel B</TabsContent>
      </Tabs>,
    );
    expect(screen.getByRole('tablist')).toBeInTheDocument();
    await user.tab();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'B' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Panel B')).toBeVisible();
  });
});

describe('Stepper', () => {
  it('marks the current step', () => {
    render(<Stepper steps={['JD', 'Resume', 'Run']} current={1} />);
    expect(screen.getByText('Resume').closest('li')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText('JD')).toHaveTextContent('JD (completed)');
  });
});
