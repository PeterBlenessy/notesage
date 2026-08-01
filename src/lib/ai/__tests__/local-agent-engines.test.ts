import { describe, expect, it } from 'vitest';
import {
  LOCAL_AGENT_ENGINES,
  localAgentLabel,
  type LocalAgentEngine,
} from '../local-agent-engines';

describe('local agent engines', () => {
  it('names the engine in every connection label, Goose included', () => {
    // Both presets can be set up at once. A bare "Local Agent" sitting next to
    // "Local Agent (Pi)" in the provider dropdown gives the user no way to tell
    // which one they are about to select.
    expect(localAgentLabel('goose')).toBe('Local Agent (Goose)');
    expect(localAgentLabel('pi')).toBe('Local Agent (Pi)');
  });

  it('produces a distinct label per engine', () => {
    const labels = LOCAL_AGENT_ENGINES.map((e) => localAgentLabel(e.id));
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('marks pi as beta and Goose as not', () => {
    // pi works against a real pi binary but has never been verified end to end
    // inside the app; the badge is the honest signal for that.
    const byId = Object.fromEntries(LOCAL_AGENT_ENGINES.map((e) => [e.id, e]));
    expect(byId.pi.beta).toBe(true);
    expect(byId.goose.beta).toBeFalsy();
  });

  it('lists Goose first — it is the default and the verified path', () => {
    expect(LOCAL_AGENT_ENGINES[0].id).toBe('goose');
  });

  it('credits every engine upstream', () => {
    for (const e of LOCAL_AGENT_ENGINES) {
      expect(e.attribution.length).toBeGreaterThan(0);
    }
  });

  it('falls back to the raw id for an unknown engine rather than throwing', () => {
    // Defensive: a persisted connection could carry an engine this build has
    // dropped. A odd-looking label beats a crash in the provider dropdown.
    expect(localAgentLabel('zzz' as LocalAgentEngine)).toBe('Local Agent (zzz)');
  });
});
