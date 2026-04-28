import { RefreshCw, ScrollText, ChevronDown, Plus, MoreHorizontal, Trash2, ArrowUpFromLine, ArrowDownToLine, Pencil } from 'lucide-react';
import { useState, useMemo } from 'react';
import { toast } from 'sonner';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useSkillStore, SOURCE_PRIORITY, type SkillEntry, type AgentEntry } from '@/stores/skill-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useSettingsStore } from '@/stores/settings-store';
import { AgentIcon } from '@/components/AgentIcon';
import { tauriApi } from '@/lib/tauri';
import { cn } from '@/lib/utils';
import { NewSkillWizard } from '@/components/NewSkillWizard';
import { NewAgentWizard } from '@/components/NewAgentWizard';
import { McpServersSettings } from '@/components/settings/McpServersSettings';
import { NewAddressableAgentDialog } from '@/components/settings/NewAddressableAgentDialog';
import { EditSkillDialog } from '@/components/settings/EditSkillDialog';
import { EditAgentDialog } from '@/components/settings/EditAgentDialog';
import { isManageable, sourceLabel, sourceBadgeClass } from '@/components/settings/skills-settings-utils';

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

function SkillCard({ skill, allSkills, onDelete, onMove, onEdit }: {
  skill: SkillEntry;
  allSkills: SkillEntry[];
  onDelete?: (skill: SkillEntry) => void;
  onMove?: (skill: SkillEntry, direction: 'to-global' | 'to-project') => void;
  onEdit?: (skill: SkillEntry) => void;
}) {
  const { enabledOverrides, toggleSkill } = useSkillStore();
  const overriddenBy = isOverridden(skill, allSkills);
  const isEnabled = enabledOverrides[skill.path] !== false;
  const isExternal = !['notesage-project', 'notesage-global'].includes(skill.source);
  const manageable = isManageable(skill.source, skill.name, 'skill');

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
            <span className="inline-flex items-center px-1.5 py-px rounded-full text-[10px] font-medium bg-muted text-muted-foreground">scripts</span>
          )}
          {(() => {
            const toolCount = useSkillStore.getState().skillTools.filter((t) => t.skill_name === skill.name).length;
            return toolCount > 0 ? (
              <span className="inline-flex items-center px-1.5 py-px rounded-full text-[10px] font-medium bg-foreground/10 text-foreground/70">
                {toolCount} {toolCount === 1 ? 'tool' : 'tools'}
              </span>
            ) : null;
          })()}
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
      <div className="flex items-center gap-1.5 shrink-0">
        {manageable && (onEdit || onDelete || onMove) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="h-6 w-6 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors focus-visible:[outline:1px_solid_var(--color-accent-primary)] focus-visible:[outline-offset:2px]">
                <MoreHorizontal className="h-3.5 w-3.5" strokeWidth={1.5} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {onEdit && (
                <DropdownMenuItem onClick={() => onEdit(skill)}>
                  <Pencil className="h-3.5 w-3.5 mr-2" strokeWidth={1.5} />
                  Edit
                </DropdownMenuItem>
              )}
              {skill.source === 'notesage-project' && onMove && (
                <DropdownMenuItem onClick={() => onMove(skill, 'to-global')}>
                  <ArrowUpFromLine className="h-3.5 w-3.5 mr-2" strokeWidth={1.5} />
                  Move to Global
                </DropdownMenuItem>
              )}
              {skill.source === 'notesage-global' && onMove && (
                <DropdownMenuItem onClick={() => onMove(skill, 'to-project')}>
                  <ArrowDownToLine className="h-3.5 w-3.5 mr-2" strokeWidth={1.5} />
                  Move to Project
                </DropdownMenuItem>
              )}
              {(onEdit || onMove) && onDelete && <DropdownMenuSeparator />}
              {onDelete && (
                <DropdownMenuItem onClick={() => onDelete(skill)}>
                  <Trash2 className="h-3.5 w-3.5 mr-2" strokeWidth={1.5} />
                  Delete
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {!overriddenBy && !isExternal && (
          <Switch
            checked={isEnabled}
            onCheckedChange={(checked) => toggleSkill(skill.path, checked)}
          />
        )}
      </div>
    </div>
  );
}

function SkillGroup({
  title,
  skills,
  allSkills,
  readOnly,
  onDelete,
  onMove,
  onEdit,
}: {
  title: string;
  skills: SkillEntry[];
  allSkills: SkillEntry[];
  readOnly?: boolean;
  onDelete?: (skill: SkillEntry) => void;
  onMove?: (skill: SkillEntry, direction: 'to-global' | 'to-project') => void;
  onEdit?: (skill: SkillEntry) => void;
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
          <SkillCard key={skill.path} skill={skill} allSkills={allSkills} onDelete={onDelete} onMove={onMove} onEdit={onEdit} />
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

function AgentCard({ agent, allAgents, onDelete, onMove, onEdit }: {
  agent: AgentEntry;
  allAgents: AgentEntry[];
  onDelete?: (agent: AgentEntry) => void;
  onMove?: (agent: AgentEntry, direction: 'to-global' | 'to-project') => void;
  onEdit?: (agent: AgentEntry) => void;
}) {
  const { agentEnabledOverrides, toggleAgent } = useSkillStore();
  const overriddenBy = isAgentOverridden(agent, allAgents);
  const isEnabled = agentEnabledOverrides[agent.path] !== false;
  const manageable = isManageable(agent.source, agent.name, 'agent');

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
      <div className="flex items-center gap-1.5 shrink-0">
        {manageable && (onEdit || onDelete || onMove) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="h-6 w-6 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors focus-visible:[outline:1px_solid_var(--color-accent-primary)] focus-visible:[outline-offset:2px]">
                <MoreHorizontal className="h-3.5 w-3.5" strokeWidth={1.5} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {onEdit && (
                <DropdownMenuItem onClick={() => onEdit(agent)}>
                  <Pencil className="h-3.5 w-3.5 mr-2" strokeWidth={1.5} />
                  Edit
                </DropdownMenuItem>
              )}
              {agent.source === 'notesage-project' && onMove && (
                <DropdownMenuItem onClick={() => onMove(agent, 'to-global')}>
                  <ArrowUpFromLine className="h-3.5 w-3.5 mr-2" strokeWidth={1.5} />
                  Move to Global
                </DropdownMenuItem>
              )}
              {agent.source === 'notesage-global' && onMove && (
                <DropdownMenuItem onClick={() => onMove(agent, 'to-project')}>
                  <ArrowDownToLine className="h-3.5 w-3.5 mr-2" strokeWidth={1.5} />
                  Move to Project
                </DropdownMenuItem>
              )}
              {(onEdit || onMove) && onDelete && <DropdownMenuSeparator />}
              {onDelete && (
                <DropdownMenuItem onClick={() => onDelete(agent)}>
                  <Trash2 className="h-3.5 w-3.5 mr-2" strokeWidth={1.5} />
                  Delete
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {!overriddenBy && (
          <Switch
            checked={isEnabled}
            onCheckedChange={(checked) => toggleAgent(agent.path, checked)}
          />
        )}
      </div>
    </div>
  );
}

function AgentGroup({
  title,
  agents,
  allAgents,
  action,
  onDelete,
  onMove,
  onEdit,
}: {
  title: string;
  agents: AgentEntry[];
  allAgents: AgentEntry[];
  action?: React.ReactNode;
  onDelete?: (agent: AgentEntry) => void;
  onMove?: (agent: AgentEntry, direction: 'to-global' | 'to-project') => void;
  onEdit?: (agent: AgentEntry) => void;
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
          <AgentCard key={agent.path} agent={agent} allAgents={allAgents} onDelete={onDelete} onMove={onMove} onEdit={onEdit} />
        ))}
      </div>
    </div>
  );
}

export function SkillsSettings() {
  const { skills, agents, agentInstructions, isScanning, lastScanTimestamp } = useSkillStore();
  const mergedAgentInstructions = useSkillStore((s) => s.getMergedAgentInstructions());

  // Group skills by source (memoized to avoid re-filtering on unrelated state changes)
  const skillsBySource = useMemo(() => {
    const groups: Record<string, SkillEntry[]> = {};
    for (const s of skills) (groups[s.source] ??= []).push(s);
    return groups;
  }, [skills]);
  const projectSkills = skillsBySource['notesage-project'] ?? [];
  const globalSkills = skillsBySource['notesage-global'] ?? [];
  const claudeSkills = skillsBySource['claude'] ?? [];
  const codexSkills = skillsBySource['codex'] ?? [];
  const geminiSkills = skillsBySource['gemini'] ?? [];
  const agentsSkills = skillsBySource['agents'] ?? [];

  // Group agents by source (memoized)
  const agentsBySource = useMemo(() => {
    const groups: Record<string, AgentEntry[]> = {};
    for (const a of agents) (groups[a.source] ??= []).push(a);
    return groups;
  }, [agents]);
  const projectAgents = agentsBySource['notesage-project'] ?? [];
  const globalAgents = agentsBySource['notesage-global'] ?? [];
  const claudeAgents = agentsBySource['claude'] ?? [];
  const codexAgents = agentsBySource['codex'] ?? [];
  const geminiAgents = agentsBySource['gemini'] ?? [];
  const githubAgents = agentsBySource['github'] ?? [];

  const [instructionsExpanded, setInstructionsExpanded] = useState(false);
  const [skillWizardOpen, setSkillWizardOpen] = useState(false);
  const [agentWizardOpen, setAgentWizardOpen] = useState(false);
  const [newAgentOpen, setNewAgentOpen] = useState(false);
  const [editingSkill, setEditingSkill] = useState<SkillEntry | null>(null);
  const [editingAgent, setEditingAgent] = useState<AgentEntry | null>(null);

  const [rescanSpinning, setRescanSpinning] = useState(false);

  const handleRescan = () => {
    // Trigger the full discovery flow via rescanCounter (observed by useSkillDiscovery)
    useSkillStore.getState().requestRescan();
    // Show spinner for at least 600ms so the user sees feedback
    setRescanSpinning(true);
    setTimeout(() => setRescanSpinning(false), 600);
  };

  const showSpinner = isScanning || rescanSpinning;

  const skillManagement = useSettingsStore((s) => s.skillManagement);
  const projects = useWorkspaceStore((s) => s.projects);
  const firstProjectPath = projects.length > 0 ? projects[0].path : null;

  const handleDeleteSkill = async (skill: SkillEntry) => {
    try {
      await tauriApi.deletePath(skill.path);
      toast.success(`Deleted skill "${skill.name}"`);
      useSkillStore.getState().requestRescan();
    } catch (e) {
      toast.error(`Failed to delete skill: ${e}`);
    }
  };

  const handleMoveSkill = async (skill: SkillEntry, direction: 'to-global' | 'to-project') => {
    const home = await tauriApi.getHomeDir();
    const skillName = skill.path.split('/').pop()!;

    if (direction === 'to-global') {
      const destDir = `${home}/.notesage/skills`;
      const dest = `${destDir}/${skillName}`;
      try {
        await tauriApi.createDirectory(destDir).catch(() => {});
        // Skill is a directory — try rename first (same filesystem), fall back to copy+delete
        try {
          await tauriApi.renamePath(skill.path, dest);
        } catch {
          await tauriApi.copyDirectory(skill.path, dest);
          await tauriApi.deletePath(skill.path);
        }
        toast.success(`Moved "${skill.name}" to Global`);
        useSkillStore.getState().requestRescan();
      } catch (e) {
        toast.error(`Failed to move skill: ${e}`);
      }
    } else {
      if (!firstProjectPath) {
        toast.error('No project open — open a project first');
        return;
      }
      const destDir = `${firstProjectPath}/.notesage/skills`;
      const dest = `${destDir}/${skillName}`;
      try {
        await tauriApi.createDirectory(destDir).catch(() => {});
        try {
          await tauriApi.renamePath(skill.path, dest);
        } catch {
          await tauriApi.copyDirectory(skill.path, dest);
          await tauriApi.deletePath(skill.path);
        }
        toast.success(`Moved "${skill.name}" to Project`);
        useSkillStore.getState().requestRescan();
      } catch (e) {
        toast.error(`Failed to move skill: ${e}`);
      }
    }
  };

  const handleDeleteAgent = async (agent: AgentEntry) => {
    try {
      await tauriApi.deletePath(agent.path);
      toast.success(`Deleted agent "${agent.name}"`);
      useSkillStore.getState().requestRescan();
    } catch (e) {
      toast.error(`Failed to delete agent: ${e}`);
    }
  };

  const handleMoveAgent = async (agent: AgentEntry, direction: 'to-global' | 'to-project') => {
    const home = await tauriApi.getHomeDir();
    const fileName = agent.path.split('/').pop()!;

    if (direction === 'to-global') {
      const destDir = `${home}/.notesage/agents`;
      const dest = `${destDir}/${fileName}`;
      try {
        await tauriApi.createDirectory(destDir).catch(() => {});
        await tauriApi.renamePath(agent.path, dest);
        toast.success(`Moved "${agent.name}" to Global`);
        useSkillStore.getState().requestRescan();
      } catch (e) {
        toast.error(`Failed to move agent: ${e}`);
      }
    } else {
      if (!firstProjectPath) {
        toast.error('No project open — open a project first');
        return;
      }
      const destDir = `${firstProjectPath}/.notesage/agents`;
      const dest = `${destDir}/${fileName}`;
      try {
        await tauriApi.createDirectory(destDir).catch(() => {});
        await tauriApi.renamePath(agent.path, dest);
        toast.success(`Moved "${agent.name}" to Project`);
        useSkillStore.getState().requestRescan();
      } catch (e) {
        toast.error(`Failed to move agent: ${e}`);
      }
    }
  };

  const sortedInstructions = [...agentInstructions].sort((a, b) => b.priority - a.priority);

  return (
    <div className="space-y-6">
      {/* Skills Section */}
      <div className="space-y-4">
        <div>
          <div className="flex items-center justify-between">
            <Label className="text-sm font-semibold">Skills</Label>
            <div className="flex items-center gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSkillWizardOpen(true)}
              >
                <Plus className="h-3.5 w-3.5 mr-1" strokeWidth={1.5} />
                Add
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRescan}
                disabled={showSpinner}
              >
                <RefreshCw className={cn('h-3.5 w-3.5', showSpinner && 'animate-spin')} strokeWidth={1.5} />
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Discovered skills from your projects, global config, and connected providers
          </p>
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
            <SkillGroup title="Project (.notesage/skills/)" skills={projectSkills} allSkills={skills} onDelete={skillManagement ? handleDeleteSkill : undefined} onMove={skillManagement ? handleMoveSkill : undefined} onEdit={setEditingSkill} />
            <SkillGroup title="Global (~/.notesage/skills/)" skills={globalSkills} allSkills={skills} onDelete={skillManagement ? handleDeleteSkill : undefined} onMove={skillManagement ? handleMoveSkill : undefined} onEdit={setEditingSkill} />
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
        <div>
          <div className="flex items-center justify-between">
            <Label className="text-sm font-semibold">Agents</Label>
            <div className="flex items-center gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setNewAgentOpen(true)}
              >
                <Plus className="h-3.5 w-3.5 mr-1" strokeWidth={1.5} />
                Add
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRescan}
                disabled={showSpinner}
              >
                <RefreshCw className={cn('h-3.5 w-3.5', showSpinner && 'animate-spin')} strokeWidth={1.5} />
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Addressable AI agents from your projects, global config, and connected providers
          </p>
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
            <AgentGroup title="Project (.notesage/agents/)" agents={projectAgents} allAgents={agents} onDelete={skillManagement ? handleDeleteAgent : undefined} onMove={skillManagement ? handleMoveAgent : undefined} onEdit={setEditingAgent} />
            <AgentGroup title="Global (~/.notesage/agents/)" agents={globalAgents} allAgents={agents} onDelete={skillManagement ? handleDeleteAgent : undefined} onMove={skillManagement ? handleMoveAgent : undefined} onEdit={setEditingAgent} />
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
            Add
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
            <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors rounded focus-visible:[outline:1px_solid_var(--color-accent-primary)] focus-visible:[outline-offset:2px]">
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

      <div className="h-px bg-border" />

      {/* MCP Servers Section */}
      <McpServersSettings />

      {/* Last scan info */}
      {lastScanTimestamp > 0 && (
        <p className="text-xs text-muted-foreground">
          Last scanned: {new Date(lastScanTimestamp).toLocaleTimeString()}
        </p>
      )}

      <NewSkillWizard open={skillWizardOpen} onOpenChange={setSkillWizardOpen} />
      <NewAgentWizard open={agentWizardOpen} onOpenChange={setAgentWizardOpen} />
      <NewAddressableAgentDialog open={newAgentOpen} onOpenChange={setNewAgentOpen} />
      {editingSkill && (
        <EditSkillDialog
          skill={editingSkill}
          open={!!editingSkill}
          onOpenChange={(open) => { if (!open) setEditingSkill(null); }}
        />
      )}
      {editingAgent && (
        <EditAgentDialog
          agent={editingAgent}
          open={!!editingAgent}
          onOpenChange={(open) => { if (!open) setEditingAgent(null); }}
        />
      )}
    </div>
  );
}
