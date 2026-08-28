/**
 * The lookup key for managed-agent update info.
 *
 * `agent_check_updates` returns entries keyed by agent ID — "goose", "pi",
 * "notesage-acp-pi". The connection card looks them up by the connection's
 * `agentBinary`, and those two were not the same thing:
 *
 *   standard agent      agentBinary = "copilot-language-server"   (a name)
 *   Local Agent preset  agentBinary = "/Users/…/bin/goose"        (a PATH)
 *
 * The preset's value comes from `resolveManagedPath`, so the lookup was
 * `agentUpdates["/Users/…/bin/goose"]` and could never match. The check found
 * Goose ten versions behind and the card had nowhere to put it — which is why
 * "check for agent updates" spun and appeared to do nothing at all.
 */
import { describe, it, expect } from 'vitest';
import { agentIdFromBinary } from '../ConnectionsSettings';

describe('agentIdFromBinary', () => {
  it('resolves a Local Agent preset path to its agent id', () => {
    // The reported case.
    expect(agentIdFromBinary('/Users/peter/.notesage/agents/bin/goose')).toBe('goose');
    expect(agentIdFromBinary('/Users/peter/.notesage/agents/bin/notesage-acp-pi')).toBe(
      'notesage-acp-pi',
    );
  });

  it('leaves a bare agent name untouched', () => {
    // Standard agents already store the id; the fix must not mangle them.
    expect(agentIdFromBinary('copilot-language-server')).toBe('copilot-language-server');
    expect(agentIdFromBinary('claude-agent-acp')).toBe('claude-agent-acp');
  });

  it('returns null for nothing usable rather than a key that matches nothing', () => {
    // A null lookup key is skipped; an empty-string key would silently miss
    // while looking like a real lookup.
    expect(agentIdFromBinary(undefined)).toBeNull();
    expect(agentIdFromBinary(null)).toBeNull();
    expect(agentIdFromBinary('')).toBeNull();
    expect(agentIdFromBinary('/')).toBeNull();
  });
});
