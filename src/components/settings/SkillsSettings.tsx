import { RefreshCw, ScrollText, ChevronDown, Plus } from 'lucide-react';
import { useState } from 'react';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useSkillStore, SOURCE_PRIORITY, type SkillEntry, type AgentEntry } from '@/stores/skill-store';
import { AgentIcon } from '@/components/AgentIcon';
import { cn } from '@/lib/utils';
import { NewSkillWizard } from '@/components/NewSkillWizard';
import { NewAgentWizard } from '@/components/NewAgentWizard';

/** Source label and badge styling */
function sourceLabel(source: string): string {
  switch (source) {
    case 'notesage-project': return 'Project';
    case 'notesage-global': return 'Global';
    case 'bundled': return 'Built-in';
    case 'claude': return 'Claude Code';
    case 'codex': return 'Codex';
    case 'gemini': return 'Gemini';
    case 'agents': return 'Agents';
    case 'github': return 'GitHub Copilot';
    default: return 'External';
  }
}

function sourceBadgeClass(source: string): string {
  const base = 'text-xs px-1.5 py-0.5 rounded-md border';
  switch (source) {
    case 'notesage-project':
    case 'notesage-global':
      return `${base} border-border text-foreground`;
    case 'bundled':
      return `${base} border-border text-muted-foreground`;
    default:
      return `${base} border-border text-muted-foreground`;
  }
}

/** Check if a skill is overridden by a higher-priority same-name skill. */
function isOverridden(skill: SkillEntry, allSkills: SkillEntry[]): SkillEntry | null {
  const myPriority = SOURCE_PRIORITY[skill.source as keyof typeof SOURCE_PRIORITY] ?? 1;
  for (const other of allSkills) {
    if (other.name === skill.name && other.path !== skill.path) {
      const otherPriority = SOURCE_PRIORITY[other.source as keyof typeof SOURCE_PRIORITY] ?? 1;
      if (otherPriority > myPriority) return other;
    }
  }
  return null;
}

function SkillCard({ skill, allSkills }: { skill: SkillEntry; allSkills: SkillEntry[] }) {
  const { enabledOverrides, toggleSkill } = useSkillStore();
  const overriddenBy = isOverridden(skill, allSkills);
  const isEnabled = enabledOverrides[skill.path] !== false;
  const isExternal = !['notesage-project', 'notesage-global', 'bundled'].includes(skill.source);

  return (
    <div
      className={cn(
        'flex items-start justify-between gap-3 px-3 py-2.5 rounded-lg border border-border transition-colors duration-150',
        overriddenBy ? 'opacity-50' : 'hover:border-muted-foreground',
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{skill.name}</span>
          {skill.has_scripts && (
            <span className="text-xs text-muted-foreground">scripts</span>
          )}
        </div>
        {skill.description && (
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
            {skill.description}
          </p>
        )}
        {overriddenBy && (
          <p className="text-xs text-muted-foreground mt-1">
            Overridden by {sourceLabel(overriddenBy.source)}
          </p>
        )}
      </div>
      {!overriddenBy && !isExternal && (
        <Switch
          checked={isEnabled}
          onCheckedChange={(checked) => toggleSkill(skill.path, checked)}
          className="shrink-0"
        />
      )}
    </div>
  );
}

function SkillGroup({
  title,
  skills,
  allSkills,
  readOnly,
}: {
  title: string;
  skills: SkillEntry[];
  allSkills: SkillEntry[];
  readOnly?: boolean;
}) {
  if (skills.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {title}
        </span>
        {readOnly && (
          <span className="text-xs text-muted-foreground">read-only</span>
        )}
      </div>
      <div className="space-y-1.5">
        {skills.map((skill) => (
          <SkillCard key={skill.path} skill={skill} allSkills={allSkills} />
        ))}
      </div>
    </div>
  );
}

/** Check if an agent is overridden by a higher-priority same-name agent. */
function isAgentOverridden(agent: AgentEntry, allAgents: AgentEntry[]): AgentEntry | null {
  const myPriority = SOURCE_PRIORITY[agent.source as keyof typeof SOURCE_PRIORITY] ?? 1;
  for (const other of allAgents) {
    if (other.name === agent.name && other.path !== agent.path) {
      const otherPriority = SOURCE_PRIORITY[other.source as keyof typeof SOURCE_PRIORITY] ?? 1;
      if (otherPriority > myPriority) return other;
    }
  }
  return null;
}

function AgentCard({ agent, allAgents }: { agent: AgentEntry; allAgents: AgentEntry[] }) {
  const { agentEnabledOverrides, toggleAgent } = useSkillStore();
  const overriddenBy = isAgentOverridden(agent, allAgents);
  const isEnabled = agentEnabledOverrides[agent.path] !== false;

  return (
    <div
      className={cn(
        'flex items-start justify-between gap-3 px-3 py-2.5 rounded-lg border border-border transition-colors duration-150',
        overriddenBy ? 'opacity-50' : 'hover:border-muted-foreground',
      )}
    >
      <div className="flex items-start gap-2.5 min-w-0 flex-1">
        <AgentIcon icon={agent.icon} size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <span className="text-sm font-medium truncate block">{agent.name}</span>
          {agent.description && (
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
              {agent.description}
            </p>
          )}
          {agent.model && (
            <span className="text-xs text-muted-foreground mt-0.5 block">
              model: {agent.model}
            </span>
          )}
          {overriddenBy && (
            <p className="text-xs text-muted-foreground mt-1">
              Overridden by {sourceLabel(overriddenBy.source)}
            </p>
          )}
        </div>
      </div>
      {!overriddenBy && (
        <Switch
          checked={isEnabled}
          onCheckedChange={(checked) => toggleAgent(agent.path, checked)}
          className="shrink-0"
        />
      )}
    </div>
  );
}

function AgentGroup({
  title,
  agents,
  allAgents,
  action,
}: {
  title: string;
  agents: AgentEntry[];
  allAgents: AgentEntry[];
  action?: React.ReactNode;
}) {
  if (agents.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {title}
        </span>
        {action}
      </div>
      <div className="space-y-1.5">
        {agents.map((agent) => (
          <AgentCard key={agent.path} agent={agent} allAgents={allAgents} />
        ))}
      </div>
    </div>
  );
}

export function SkillsSettings() {
  const { skills, agents, agentInstructions, isScanning, scanSkills, scanAgents, lastScanTimestamp } = useSkillStore();
  const mergedAgentInstructions = useSkillStore((s) => s.getMergedAgentInstructions());

  // Group skills by source
  const projectSkills = skills.filter((s) => s.source === 'notesage-project');
  const globalSkills = skills.filter((s) => s.source === 'notesage-global');
  const bundledSkills = skills.filter((s) => s.source === 'bundled');
  const claudeSkills = skills.filter((s) => s.source === 'claude');
  const codexSkills = skills.filter((s) => s.source === 'codex');
  const geminiSkills = skills.filter((s) => s.source === 'gemini');
  const agentsSkills = skills.filter((s) => s.source === 'agents');

  // Group agents by source
  const projectAgents = agents.filter((a) => a.source === 'notesage-project');
  const globalAgents = agents.filter((a) => a.source === 'notesage-global');
  const bundledAgents = agents.filter((a) => a.source === 'bundled');
  const claudeAgents = agents.filter((a) => a.source === 'claude');
  const codexAgents = agents.filter((a) => a.source === 'codex');
  const geminiAgents = agents.filter((a) => a.source === 'gemini');
  const githubAgents = agents.filter((a) => a.source === 'github');

  const [instructionsExpanded, setInstructionsExpanded] = useState(false);
  const [skillWizardOpen, setSkillWizardOpen] = useState(false);
  const [agentWizardOpen, setAgentWizardOpen] = useState(false);

  const handleRescan = async () => {
    // Re-derive base dirs from existing skills and agents, then rescan both
    const store = useSkillStore.getState();
    const baseDirs = new Set<string>();
    for (const skill of store.skills) {
      const parent = skill.path.substring(0, skill.path.lastIndexOf('/'));
      baseDirs.add(parent);
    }
    const agentDirs = new Set<string>();
    for (const agent of store.agents) {
      const parent = agent.path.substring(0, agent.path.lastIndexOf('/'));
      agentDirs.add(parent);
    }
    await Promise.all([
      baseDirs.size > 0 ? scanSkills(Array.from(baseDirs)) : Promise.resolve(),
      agentDirs.size > 0 ? scanAgents(Array.from(agentDirs)) : Promise.resolve(),
    ]);
  };

  const sortedInstructions = [...agentInstructions].sort((a, b) => b.priority - a.priority);

  return (
    <div className="space-y-6">
      {/* Skills Section */}
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Label className="text-sm font-semibold">Skills</Label>
            <p className="text-xs text-muted-foreground mt-1">
              Discovered skills from your projects, global config, and connected providers
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSkillWizardOpen(true)}
            >
              <Plus className="h-3.5 w-3.5 mr-1" strokeWidth={1.5} />
              New Skill
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRescan}
              disabled={isScanning}
            >
              <RefreshCw className={cn('h-3.5 w-3.5 mr-1.5', isScanning && 'animate-spin')} strokeWidth={1.5} />
              {isScanning ? 'Scanning...' : 'Rescan'}
            </Button>
          </div>
        </div>

        {skills.length === 0 ? (
          <div className="px-4 py-8 text-center rounded-lg border border-dashed border-border">
            <p className="text-sm text-muted-foreground">No skills discovered</p>
            <p className="text-xs text-muted-foreground mt-1">
              Add skills to <code className="text-xs">.notesage/skills/</code> in your project
              or <code className="text-xs">~/.notesage/skills/</code> globally
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <SkillGroup title="Project (.notesage/skills/)" skills={projectSkills} allSkills={skills} />
            <SkillGroup title="Global (~/.notesage/skills/)" skills={globalSkills} allSkills={skills} />
            <SkillGroup title="Built-in" skills={bundledSkills} allSkills={skills} />
            <SkillGroup title="Claude Code (~/.claude/skills/)" skills={claudeSkills} allSkills={skills} readOnly />
            <SkillGroup title="Codex (~/.codex/skills/)" skills={codexSkills} allSkills={skills} readOnly />
            <SkillGroup title="Gemini (~/.gemini/skills/)" skills={geminiSkills} allSkills={skills} readOnly />
            <SkillGroup title="Agents (~/.agents/skills/)" skills={agentsSkills} allSkills={skills} readOnly />
          </div>
        )}
      </div>

      <div className="h-px bg-border" />

      {/* Agents Section */}
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Label className="text-sm font-semibold">Agents</Label>
            <p className="text-xs text-muted-foreground mt-1">
              Addressable AI agents from your projects, global config, and connected providers
            </p>
          </div>
        </div>

        {agents.length === 0 ? (
          <div className="px-4 py-8 text-center rounded-lg border border-dashed border-border">
            <p className="text-sm text-muted-foreground">No agents discovered</p>
            <p className="text-xs text-muted-foreground mt-1">
              Add agent files to <code className="text-xs">.notesage/agents/</code> in your project
              or <code className="text-xs">~/.notesage/agents/</code> globally
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <AgentGroup title="Project (.notesage/agents/)" agents={projectAgents} allAgents={agents} />
            <AgentGroup title="Global (~/.notesage/agents/)" agents={globalAgents} allAgents={agents} />
            <AgentGroup title="Built-in" agents={bundledAgents} allAgents={agents} />
            <AgentGroup title="Claude Code (~/.claude/agents/)" agents={claudeAgents} allAgents={agents} />
            <AgentGroup title="Codex (~/.codex/agents/)" agents={codexAgents} allAgents={agents} />
            <AgentGroup title="Gemini (~/.gemini/agents/)" agents={geminiAgents} allAgents={agents} />
            <AgentGroup title="GitHub Copilot (.github/agents/)" agents={githubAgents} allAgents={agents} />
          </div>
        )}
      </div>

      <div className="h-px bg-border" />

      {/* Agent Instructions Section */}
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Label className="text-sm font-semibold">Agent Instructions</Label>
            <p className="text-xs text-muted-foreground mt-1">
              Instruction files injected into AI context. Higher priority files take precedence.
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setAgentWizardOpen(true)}
            className="shrink-0"
          >
            <Plus className="h-3.5 w-3.5 mr-1" strokeWidth={1.5} />
            New
          </Button>
        </div>

        {agentInstructions.length === 0 ? (
          <div className="px-4 py-8 text-center rounded-lg border border-dashed border-border">
            <p className="text-sm text-muted-foreground">No agent instruction files found</p>
            <p className="text-xs text-muted-foreground mt-1">
              Create <code className="text-xs">.notesage/agents.md</code> in your project
              or <code className="text-xs">~/.notesage/agents.md</code> globally
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {sortedInstructions.map((inst) => {
              const isNotesage = inst.source_type === 'notesage-project' || inst.source_type === 'notesage-global';
              const filename = inst.source.split('/').pop() || inst.source;

              return (
                <div
                  key={`${inst.source_type}-${inst.priority}`}
                  className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-border hover:border-muted-foreground transition-colors duration-150"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-medium text-muted-foreground tabular-nums w-4 shrink-0 text-right">
                      {inst.priority}
                    </span>
                    <ScrollText className="h-3.5 w-3.5 text-muted-foreground shrink-0" strokeWidth={1.5} />
                    <span className="text-sm truncate">{filename}</span>
                    <span className={sourceBadgeClass(inst.source_type)}>
                      {sourceLabel(inst.source_type)}
                    </span>
                  </div>
                  {!isNotesage && (
                    <span className="text-xs text-muted-foreground shrink-0">read-only</span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Preview merged context */}
        {agentInstructions.length > 0 && (
          <Collapsible open={instructionsExpanded} onOpenChange={setInstructionsExpanded}>
            <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
              <ChevronDown
                className={cn('h-3 w-3 transition-transform duration-150', !instructionsExpanded && '-rotate-90')}
                strokeWidth={1.5}
              />
              Preview merged context
            </CollapsibleTrigger>
            <CollapsibleContent>
              <pre className="mt-2 p-3 rounded-lg bg-muted text-xs text-muted-foreground whitespace-pre-wrap max-h-48 overflow-y-auto thin-scrollbar">
                {mergedAgentInstructions}
              </pre>
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>

      {/* Last scan info */}
      {lastScanTimestamp > 0 && (
        <p className="text-xs text-muted-foreground">
          Last scanned: {new Date(lastScanTimestamp).toLocaleTimeString()}
        </p>
      )}

      <NewSkillWizard open={skillWizardOpen} onOpenChange={setSkillWizardOpen} />
      <NewAgentWizard open={agentWizardOpen} onOpenChange={setAgentWizardOpen} />
    </div>
  );
}
