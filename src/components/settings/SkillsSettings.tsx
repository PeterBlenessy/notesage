import { RefreshCw, ScrollText, ChevronDown, Plus, MoreHorizontal, Trash2, ArrowUpFromLine, ArrowDownToLine, Pencil } from 'lucide-react';
import { useState, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useSkillStore, SOURCE_PRIORITY, type SkillEntry, type AgentEntry } from '@/stores/skill-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useSettingsStore } from '@/stores/settings-store';
import { AgentIcon } from '@/components/AgentIcon';
import { tauriApi } from '@/lib/tauri';
import { parseFrontmatter, serializeFrontmatter } from '@/lib/frontmatter';
import { cn } from '@/lib/utils';
import { NewSkillWizard } from '@/components/NewSkillWizard';
import { NewAgentWizard } from '@/components/NewAgentWizard';
import { McpServersSettings } from '@/components/settings/McpServersSettings';

/** Bundled skill names — always overwritten on startup, not user-manageable. */
const BUNDLED_SKILL_NAMES = new Set(['create-skill', 'create-agent']);

/** Bundled agent names — always overwritten on startup, not user-manageable. */
const BUNDLED_AGENT_NAMES = new Set([
  'general-assistant', 'creative-writer', 'technical-editor',
  'fact-checker', 'academic-writer', 'copywriter', 'proofreader',
]);

/** Check if a skill/agent is user-manageable (notesage source, not bundled). */
function isManageable(source: string, name: string, type: 'skill' | 'agent'): boolean {
  if (source !== 'notesage-global' && source !== 'notesage-project') return false;
  if (type === 'skill') return !BUNDLED_SKILL_NAMES.has(name);
  return !BUNDLED_AGENT_NAMES.has(name);
}

/** Source label and badge styling */
function sourceLabel(source: string): string {
  switch (source) {
    case 'notesage-project': return 'Project';
    case 'notesage-global': return 'Global';
    // 'bundled' removed — bundled items now use 'notesage-global'
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
      <div className="flex items-center gap-1.5 shrink-0">
        {manageable && (onEdit || onDelete || onMove) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="h-6 w-6 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
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
              <button className="h-6 w-6 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
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

// ---------------------------------------------------------------------------
// New Addressable Agent Dialog
// ---------------------------------------------------------------------------

function NewAddressableAgentDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [model, setModel] = useState('');
  const [icon, setIcon] = useState('');
  const [allowedTools, setAllowedTools] = useState('');
  const [userInvocable, setUserInvocable] = useState(true);
  const [disableModelInvocation, setDisableModelInvocation] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  const reset = () => {
    setName('');
    setDescription('');
    setInstructions('');
    setModel('');
    setIcon('');
    setAllowedTools('');
    setUserInvocable(true);
    setDisableModelInvocation(false);
    setAdvancedOpen(false);
  };

  const handleSave = async () => {
    if (!name.trim() || !description.trim()) {
      toast.error('Name and description are required');
      return;
    }
    if (!slug) {
      toast.error('Name must contain at least one letter or number');
      return;
    }

    setSaving(true);
    try {
      const home = await tauriApi.getHomeDir();
      const dir = `${home}/.notesage/agents`;
      const filePath = `${dir}/${slug}.md`;

      // Check if file already exists
      const exists = await tauriApi.pathExists(filePath);
      if (exists) {
        toast.error(`Agent "${slug}" already exists`);
        setSaving(false);
        return;
      }

      // Build frontmatter
      const fm: Record<string, unknown> = {
        name: slug,
        description: description.trim(),
      };
      if (model.trim()) fm.model = model.trim();
      if (icon.trim()) fm.icon = icon.trim();
      if (!userInvocable) fm['user-invocable'] = false;
      if (disableModelInvocation) fm['disable-model-invocation'] = true;
      const toolsList = allowedTools.split(',').map((t) => t.trim()).filter(Boolean);
      if (toolsList.length > 0) fm['allowed-tools'] = toolsList;

      const body = instructions.trim() || '';
      const content = serializeFrontmatter(fm, body + '\n');

      await tauriApi.createDirectory(dir).catch(() => {});
      await tauriApi.writeFile(filePath, content);
      toast.success(`Created agent "${slug}"`);
      useSkillStore.getState().requestRescan();
      onOpenChange(false);
      reset();
    } catch (err) {
      toast.error(`Failed to create agent: ${err}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Agent</DialogTitle>
          <DialogDescription>Create an addressable agent with custom instructions.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 overflow-y-auto max-h-[60vh]">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Code Reviewer"
              className="text-sm"
              autoFocus
            />
            {slug && (
              <p className="text-xs text-muted-foreground">
                File: <code className="text-xs">~/.notesage/agents/{slug}.md</code>
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Description</Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="When to use this agent and what it does"
              className="text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Instructions</Label>
            <Textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="System prompt — tell the agent how to behave (optional, edit later)"
              className="text-sm min-h-[100px] resize-y"
            />
          </div>

          {/* Advanced options */}
          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none">
              <ChevronDown
                className={cn('h-3 w-3 transition-transform duration-150', !advancedOpen && '-rotate-90')}
                strokeWidth={1.5}
              />
              Advanced options
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="space-y-4 pt-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Allowed tools</Label>
                  <Input
                    value={allowedTools}
                    onChange={(e) => setAllowedTools(e.target.value)}
                    placeholder="e.g., Read, Grep, Glob (comma-separated)"
                    className="font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground">
                    Restrict which tools/skills this agent can use. Leave empty for no restrictions.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Model preference</Label>
                  <Input
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder="e.g., sonnet, opus, haiku"
                    className="font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground">
                    Preferred model. Matched against available connections.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Icon</Label>
                  <Input
                    value={icon}
                    onChange={(e) => setIcon(e.target.value)}
                    placeholder="Lucide icon name or emoji (e.g., sparkles, 🔍)"
                    className="text-sm"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-sm">User-invocable</Label>
                    <p className="text-xs text-muted-foreground">Show in the agent picker and @ menu</p>
                  </div>
                  <Switch checked={userInvocable} onCheckedChange={setUserInvocable} />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-sm">Disable model invocation</Label>
                    <p className="text-xs text-muted-foreground">Prevent AI from auto-selecting this agent</p>
                  </div>
                  <Switch checked={disableModelInvocation} onCheckedChange={setDisableModelInvocation} />
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !name.trim() || !description.trim()}>
            {saving ? 'Creating...' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Edit Skill Dialog
// ---------------------------------------------------------------------------

function EditSkillDialog({ skill, open, onOpenChange }: {
  skill: SkillEntry;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [allowedTools, setAllowedTools] = useState('');
  const [userInvocable, setUserInvocable] = useState(true);
  const [disableModelInvocation, setDisableModelInvocation] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await tauriApi.readFile(`${skill.path}/SKILL.md`);
        if (cancelled) return;
        const { frontmatter: fm, content } = parseFrontmatter(raw);

        setDescription(typeof fm?.description === 'string' ? fm.description : skill.description);
        setInstructions(content.trim());
        setAllowedTools(Array.isArray(fm?.['allowed-tools']) ? fm['allowed-tools'].join(', ') : '');
        setUserInvocable(fm?.['user-invocable'] !== false);
        setDisableModelInvocation(fm?.['disable-model-invocation'] === true);
        setAdvancedOpen(false);
        setLoaded(true);
      } catch (e) {
        if (!cancelled) {
          toast.error(`Failed to read skill: ${e}`);
          onOpenChange(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [skill.path]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    if (!description.trim()) {
      toast.error('Description is required');
      return;
    }
    setSaving(true);
    try {
      const fm: Record<string, unknown> = {
        name: skill.name,
        description: description.trim(),
      };
      if (userInvocable) fm['user-invocable'] = true;
      if (disableModelInvocation) fm['disable-model-invocation'] = true;
      const toolsList = allowedTools.split(',').map((t) => t.trim()).filter(Boolean);
      if (toolsList.length > 0) fm['allowed-tools'] = toolsList;

      const body = instructions.trim() || '';
      const content = serializeFrontmatter(fm, body + '\n');

      await tauriApi.writeFile(`${skill.path}/SKILL.md`, content);
      toast.success(`Updated skill "${skill.name}"`);
      useSkillStore.getState().requestRescan();
      onOpenChange(false);
    } catch (e) {
      toast.error(`Failed to save skill: ${e}`);
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Skill</DialogTitle>
          <DialogDescription>
            <code className="text-xs">{skill.name}</code> — {sourceLabel(skill.source)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 overflow-y-auto max-h-[60vh]">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="text-sm resize-y"
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Instructions</Label>
            <Textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={6}
              className="text-sm resize-y min-h-[100px]"
            />
          </div>

          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none">
              <ChevronDown
                className={cn('h-3 w-3 transition-transform duration-150', !advancedOpen && '-rotate-90')}
                strokeWidth={1.5}
              />
              Advanced options
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="space-y-4 pt-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Allowed tools</Label>
                  <Input
                    value={allowedTools}
                    onChange={(e) => setAllowedTools(e.target.value)}
                    placeholder="e.g., Read, Edit, Bash (comma-separated)"
                    className="font-mono text-sm"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-sm">User-invocable</Label>
                    <p className="text-xs text-muted-foreground">Show in the / command menu</p>
                  </div>
                  <Switch checked={userInvocable} onCheckedChange={setUserInvocable} />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-sm">Disable model invocation</Label>
                    <p className="text-xs text-muted-foreground">Prevent AI from auto-discovering this skill</p>
                  </div>
                  <Switch checked={disableModelInvocation} onCheckedChange={setDisableModelInvocation} />
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !description.trim()}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Edit Agent Dialog
// ---------------------------------------------------------------------------

function EditAgentDialog({ agent, open, onOpenChange }: {
  agent: AgentEntry;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [model, setModel] = useState('');
  const [icon, setIcon] = useState('');
  const [allowedTools, setAllowedTools] = useState('');
  const [userInvocable, setUserInvocable] = useState(true);
  const [disableModelInvocation, setDisableModelInvocation] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await tauriApi.readFile(agent.path);
        if (cancelled) return;
        const { frontmatter: fm, content } = parseFrontmatter(raw);

        setDescription(typeof fm?.description === 'string' ? fm.description : agent.description);
        setInstructions(content.trim());
        setModel(typeof fm?.model === 'string' ? fm.model : agent.model ?? '');
        setIcon(typeof fm?.icon === 'string' ? fm.icon : agent.icon ?? '');
        setAllowedTools(Array.isArray(fm?.['allowed-tools']) ? fm['allowed-tools'].join(', ') : '');
        setUserInvocable(fm?.['user-invocable'] !== false);
        setDisableModelInvocation(fm?.['disable-model-invocation'] === true);
        setAdvancedOpen(false);
        setLoaded(true);
      } catch (e) {
        if (!cancelled) {
          toast.error(`Failed to read agent: ${e}`);
          onOpenChange(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [agent.path]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    if (!description.trim()) {
      toast.error('Description is required');
      return;
    }
    setSaving(true);
    try {
      const fm: Record<string, unknown> = {
        name: agent.name,
        description: description.trim(),
      };
      if (model.trim()) fm.model = model.trim();
      if (icon.trim()) fm.icon = icon.trim();
      if (!userInvocable) fm['user-invocable'] = false;
      if (disableModelInvocation) fm['disable-model-invocation'] = true;
      const toolsList = allowedTools.split(',').map((t) => t.trim()).filter(Boolean);
      if (toolsList.length > 0) fm['allowed-tools'] = toolsList;

      const body = instructions.trim() || '';
      const content = serializeFrontmatter(fm, body + '\n');

      await tauriApi.writeFile(agent.path, content);
      toast.success(`Updated agent "${agent.name}"`);
      useSkillStore.getState().requestRescan();
      onOpenChange(false);
    } catch (e) {
      toast.error(`Failed to save agent: ${e}`);
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Agent</DialogTitle>
          <DialogDescription>
            <code className="text-xs">{agent.name}</code> — {sourceLabel(agent.source)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 overflow-y-auto max-h-[60vh]">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Description</Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="text-sm"
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Instructions</Label>
            <Textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={6}
              className="text-sm resize-y min-h-[100px]"
            />
          </div>

          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none">
              <ChevronDown
                className={cn('h-3 w-3 transition-transform duration-150', !advancedOpen && '-rotate-90')}
                strokeWidth={1.5}
              />
              Advanced options
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="space-y-4 pt-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Allowed tools</Label>
                  <Input
                    value={allowedTools}
                    onChange={(e) => setAllowedTools(e.target.value)}
                    placeholder="e.g., Read, Grep, Glob (comma-separated)"
                    className="font-mono text-sm"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Model preference</Label>
                  <Input
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder="e.g., sonnet, opus, haiku"
                    className="font-mono text-sm"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Icon</Label>
                  <Input
                    value={icon}
                    onChange={(e) => setIcon(e.target.value)}
                    placeholder="Lucide icon name or emoji"
                    className="text-sm"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-sm">User-invocable</Label>
                    <p className="text-xs text-muted-foreground">Show in the agent picker and @ menu</p>
                  </div>
                  <Switch checked={userInvocable} onCheckedChange={setUserInvocable} />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-sm">Disable model invocation</Label>
                    <p className="text-xs text-muted-foreground">Prevent AI from auto-selecting this agent</p>
                  </div>
                  <Switch checked={disableModelInvocation} onCheckedChange={setDisableModelInvocation} />
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !description.trim()}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
