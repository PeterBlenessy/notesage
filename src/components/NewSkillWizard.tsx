import { useState } from 'react';
import { toast } from 'sonner';
import { invoke } from '@tauri-apps/api/core';
import { serializeFrontmatter } from '@/lib/frontmatter';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { ChevronDown } from 'lucide-react';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useSkillStore } from '@/stores/skill-store';
import { cn } from '@/lib/utils';

interface NewSkillWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .join('-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
}

function isValidName(name: string): string | null {
  if (!name) return 'Name is required';
  if (name.length > 64) return 'Name must be 64 characters or fewer';
  if (!/^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/.test(name)) {
    return 'Only lowercase letters, digits, and hyphens. Must start and end with alphanumeric.';
  }
  if (/--/.test(name)) return 'No consecutive hyphens allowed';
  return null;
}

export function NewSkillWizard({ open, onOpenChange }: NewSkillWizardProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [scope, setScope] = useState<'project' | 'global'>('project');
  const [includeScripts, setIncludeScripts] = useState(false);
  const [userInvocable, setUserInvocable] = useState(true);
  const [disableModelInvocation, setDisableModelInvocation] = useState(false);
  const [allowedTools, setAllowedTools] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const projects = useWorkspaceStore((s) => s.projects);
  const hasProject = projects.length > 0;

  const reset = () => {
    setName('');
    setDescription('');
    setInstructions('');
    setScope('project');
    setIncludeScripts(false);
    setUserInvocable(true);
    setDisableModelInvocation(false);
    setAllowedTools('');
    setAdvancedOpen(false);
    setIsCreating(false);
  };

  const handleClose = () => {
    reset();
    onOpenChange(false);
  };

  // Auto-suggest name from description on blur
  const handleDescriptionBlur = () => {
    if (description.trim() && !name) {
      setName(slugify(description));
    }
  };

  const handleCreate = async () => {
    setIsCreating(true);
    try {
      let targetDir: string;
      if (scope === 'project' && hasProject) {
        targetDir = `${projects[0].path}/.notesage/skills`;
      } else {
        const home = await invoke<string>('get_home_dir');
        targetDir = `${home}/.notesage/skills`;
      }

      const skillDir = `${targetDir}/${name}`;

      // Create directory structure
      await invoke('create_directory', { path: skillDir });
      if (includeScripts) {
        await invoke('create_directory', { path: `${skillDir}/scripts` });
      }

      // Build frontmatter
      const fm: Record<string, unknown> = {
        name,
        description: description.trim(),
      };
      if (userInvocable) fm['user-invocable'] = true;
      if (disableModelInvocation) fm['disable-model-invocation'] = true;
      const toolsList = allowedTools.split(',').map((t) => t.trim()).filter(Boolean);
      if (toolsList.length > 0) fm['allowed-tools'] = toolsList;

      const body = instructions.trim()
        || `# ${name}\n\nTODO — Write instructions for how the AI should use this skill.`;

      await invoke('write_file', {
        path: `${skillDir}/SKILL.md`,
        content: serializeFrontmatter(fm, body + '\n'),
      });

      // Trigger rescan
      useSkillStore.getState().requestRescan();

      toast.success(`Skill "${name}" created`, {
        description: scope === 'project' ? 'Available in this project' : 'Available in all projects',
      });

      handleClose();
    } catch (e) {
      toast.error(`Failed to create skill: ${e}`);
    } finally {
      setIsCreating(false);
    }
  };

  const nameError = name ? isValidName(name) : null;
  const canCreate = name.trim().length > 0 && description.trim().length > 0 && !nameError;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create Skill</DialogTitle>
          <DialogDescription>
            Create an Agent Skill with instructions, optional scripts, and tool access.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 overflow-y-auto max-h-[60vh]">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={handleDescriptionBlur}
              placeholder="e.g., Proofread text for grammar and clarity"
              rows={2}
              className="text-sm resize-y"
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              placeholder="e.g., proofread"
              className="font-mono text-sm"
            />
            {nameError && <p className="text-xs text-destructive mt-1">{nameError}</p>}
            <p className="text-xs text-muted-foreground">
              Lowercase letters, digits, and hyphens. Auto-suggested from description.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Instructions</Label>
            <Textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Markdown body — tell the AI how to use this skill (optional, edit later)"
              rows={3}
              className="text-sm resize-y min-h-[72px]"
            />
          </div>

          {/* Scope */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Scope</Label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setScope('project')}
                disabled={!hasProject}
                className={cn(
                  'flex-1 text-left px-3 py-2 rounded-lg border transition-colors text-sm',
                  scope === 'project'
                    ? 'border-foreground/30 bg-accent'
                    : 'border-border hover:border-muted-foreground',
                  !hasProject && 'opacity-40 cursor-not-allowed',
                )}
              >
                <div className="font-medium">Project</div>
                <div className="text-xs text-muted-foreground">.notesage/skills/</div>
              </button>
              <button
                type="button"
                onClick={() => setScope('global')}
                className={cn(
                  'flex-1 text-left px-3 py-2 rounded-lg border transition-colors text-sm',
                  scope === 'global'
                    ? 'border-foreground/30 bg-accent'
                    : 'border-border hover:border-muted-foreground',
                )}
              >
                <div className="font-medium">Global</div>
                <div className="text-xs text-muted-foreground">~/.notesage/skills/</div>
              </button>
            </div>
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
                    placeholder="e.g., Read, Edit, Bash (comma-separated)"
                    className="font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground">
                    Restrict which tools this skill may use. Leave empty for no restrictions.
                  </p>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-sm">Include scripts directory</Label>
                    <p className="text-xs text-muted-foreground">Create a scripts/ folder for executable scripts</p>
                  </div>
                  <Switch checked={includeScripts} onCheckedChange={setIncludeScripts} />
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
          <Button variant="outline" onClick={handleClose}>Cancel</Button>
          <Button disabled={!canCreate || isCreating} onClick={handleCreate}>
            {isCreating ? 'Creating...' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
