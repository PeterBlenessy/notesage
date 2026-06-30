// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderInto, serialize } from '../TokenInput';
import type { TokenOption } from '../VariablePicker';

const TOKENS: TokenOption[] = [
  { token: '{{today}}', label: "today's date" },
  { token: '{{steps.summary.output}}', label: 'summary output' },
  { token: '{{trigger.file}}', label: 'triggering file' },
];

function roundTrip(value: string): string {
  const el = document.createElement('div');
  renderInto(el, value, TOKENS);
  return serialize(el);
}

describe('TokenInput render ⇄ serialize round-trip', () => {
  it('preserves plain text', () => {
    expect(roundTrip('just some text')).toBe('just some text');
  });

  it('preserves a token verbatim (a pill serializes back to its {{token}})', () => {
    expect(roundTrip('{{today}}')).toBe('{{today}}');
  });

  it('preserves text + tokens interleaved', () => {
    const v = 'Append to Daily/{{today}}.md from {{steps.summary.output}}';
    expect(roundTrip(v)).toBe(v);
  });

  it('preserves a leading token and adjacent tokens', () => {
    expect(roundTrip('{{trigger.file}}{{today}}')).toBe('{{trigger.file}}{{today}}');
  });

  it('preserves newlines (multiline content)', () => {
    const v = '## {{today}}\n\n{{steps.summary.output}}\n';
    expect(roundTrip(v)).toBe(v);
  });

  it('renders a pill element per token with its friendly label', () => {
    const el = document.createElement('div');
    renderInto(el, 'x {{today}} y', TOKENS);
    const pills = el.querySelectorAll('[data-token]');
    expect(pills).toHaveLength(1);
    expect((pills[0] as HTMLElement).dataset.token).toBe('{{today}}');
    expect(pills[0].textContent).toBe("today's date"); // shows the friendly name, not raw syntax
  });

  it('falls back to the bare token name when no friendly label exists', () => {
    const el = document.createElement('div');
    renderInto(el, '{{unknown.thing}}', TOKENS);
    expect(el.querySelector('[data-token]')?.textContent).toBe('unknown.thing');
    expect(serialize(el)).toBe('{{unknown.thing}}'); // still round-trips
  });
});
