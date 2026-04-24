import { toast } from "sonner";
import { useSkillStore } from "@/stores/skill-store";
import { tauriApi } from "@/lib/tauri";
import type { Connection } from "@/lib/ai/connections";

/**
 * Shared `@agent-name` / `/skill-name` prefix expansion used by both the
 * legacy `ChatPanel.doSend` and the Quiet Composer `FloatingCommandBar`.
 * Extracted for task #126 so the two shells can't drift — in particular,
 * the ACP pass-through vs. direct-API swap behaviour must stay in sync
 * with `effectiveConnection?.authMethod`.
 *
 * Both helpers return `null` to mean "skip the send" (e.g. `@agent-name`
 * with no follow-up text just switches the active agent).
 */

export interface AgentExpansionResult {
  /** The message to send to the model (original string if no match). */
  content: string;
  /**
   * When true, the caller should NOT send. Happens when the user typed
   * only `@agent-name` with no trailing text — this just swaps the
   * active agent for the direct-API path.
   */
  skipSend: boolean;
}

/**
 * Interpret an `@agent-name` prefix. Returns the possibly-rewritten
 * message + a skipSend hint.
 *
 *   - ACP / Copilot LSP (authMethod === 'agent_managed'): pass through
 *     verbatim — the provider owns its own subagent system.
 *   - Direct API: if `agent-name` matches a known agent, strip the
 *     prefix + swap the active agent via skill-store. A bare
 *     `@agent-name` (no trailing text) returns `skipSend: true`.
 */
export function interpretAgentPrefix(
  content: string,
  effectiveConnection: Connection | null | undefined,
): AgentExpansionResult {
  const match = content.match(/^@([a-z0-9][a-z0-9-]*)\s*(.*)/s);
  if (!match) return { content, skipSend: false };

  const agentName = match[1];
  const rest = match[2];
  const isPassThrough = effectiveConnection?.authMethod === "agent_managed";

  if (isPassThrough) {
    return { content, skipSend: false };
  }

  const agent = useSkillStore.getState().getAgentByName(agentName);
  if (!agent) {
    // Unknown agent name — leave the literal text alone so the model
    // sees what the user typed.
    return { content, skipSend: false };
  }

  useSkillStore.getState().setActiveAgent(agentName);

  if (!rest.trim()) {
    // User only typed `@agent-name` — switch, don't send.
    return { content, skipSend: true };
  }

  return { content: rest, skipSend: false };
}

export interface SkillExpansionResult {
  /** The expanded message to send to the model. */
  content: string;
  /** The matched skill name, or undefined when no `/skill-name` prefix. */
  skillName?: string;
  /**
   * When true, the caller should abort the send. Only set when the skill
   * was named + found but its body failed to load — a toast was already
   * emitted.
   */
  abortSend?: boolean;
}

/**
 * Interpret a `/skill-name` prefix. If the name matches a known skill
 * and the skill body loads, return an expanded prompt embedding the
 * body; otherwise return the original content unchanged.
 *
 * The expansion format mirrors the legacy `ChatPanel.doSend` path so
 * the model sees the same prompt on both shells.
 */
export async function expandSkillPrefix(
  content: string,
): Promise<SkillExpansionResult> {
  const match = content.match(/^\/([a-z0-9][a-z0-9-]*)\s*(.*)/s);
  if (!match) return { content };

  const name = match[1];
  const rest = match[2];
  const skill = useSkillStore.getState().skills.find((s) => s.name === name);
  if (!skill) return { content };

  try {
    const skillContent = await tauriApi.readSkillContent(skill.path);
    const expanded = `[Using skill: ${name}]\n\n${skillContent.body}\n\n---\n\nUser request: ${rest}`;
    return { content: expanded, skillName: name };
  } catch {
    toast.error(`Failed to load skill "${name}"`);
    return { content, abortSend: true };
  }
}
