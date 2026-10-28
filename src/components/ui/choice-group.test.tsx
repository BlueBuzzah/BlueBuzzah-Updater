import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { expect, it } from 'vitest';
import { ChoiceGroup } from './choice-group';

function Harness() {
  const [v, setV] = useState<'a' | 'b' | null>('a');
  return (
    <ChoiceGroup
      label="Choose a version"
      value={v}
      onChange={setV}
      options={[{ value: 'a', title: '2.0.4' }, { value: 'b', title: '2.0.3' }]}
    />
  );
}

it('arrow keys move the selection', () => {
  render(<Harness />);
  expect(screen.getByRole('radiogroup', { name: 'Choose a version' })).toBeInTheDocument();
  const a = screen.getByRole('radio', { name: /2\.0\.4/ });
  fireEvent.keyDown(a, { key: 'ArrowDown' });
  expect(screen.getByRole('radio', { name: /2\.0\.3/ })).toHaveAttribute('aria-checked', 'true');
  expect(a).toHaveAttribute('aria-checked', 'false');
});
