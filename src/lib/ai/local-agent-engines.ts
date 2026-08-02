// The Local Agent engines offered in the Add Connection menu.
//
// Kept here rather than in the setup dialog because the engine is now chosen
// one level up — there is a separate "Local agent using <engine>" entry per
// engine, so the dialog no longer asks. Both presets can be configured at
// once, which is why every connection label names its engine.

export type LocalAgentEngine = 'goose' | 'pi';

export interface LocalAgentEngineOption {
  id: LocalAgentEngine;
  /** Human-facing name, used in the menu entry and the connection label. */
  name: string;
  /** Shown small under the entry — we are deliberate about crediting upstream. */
  attribution: string;
  /** Marks an engine that works but has not been verified end to end in-app. */
  beta?: boolean;
}

export const LOCAL_AGENT_ENGINES: LocalAgentEngineOption[] = [
  {
    id: 'goose',
    name: 'Goose',
    attribution:
      'Powered by Goose, an open-source agent from the Agentic AI Foundation (AAIF)',
  },
  {
    id: 'pi',
    name: 'Pi',
    attribution: 'Powered by pi, an open-source agent from earendil-works (MIT)',
    beta: true,
  },
];

/**
 * Connection label for a Local Agent preset.
 *
 * The engine is always named, Goose included: both presets can be set up at
 * once, and a bare "Local Agent" sitting next to "Local Agent (Pi)" in the
 * provider dropdown gives no way to tell which one is being selected.
 */
export function localAgentLabel(engine: LocalAgentEngine): string {
  const name = LOCAL_AGENT_ENGINES.find((e) => e.id === engine)?.name ?? engine;
  return `Local Agent (${name})`;
}
