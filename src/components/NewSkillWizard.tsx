import { useState } from 'react';
import { toast } from 'sonner';
import { invoke } from '@tauri-apps/api/core';
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
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useSkillStore } from '@/stores/skill-store';

interface NewSkillWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Step = 'describe' | 'name' | 'scope' | 'review';

function suggestName(description: string): string {
  return description
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
  const [step, setStep] = useState<Step>('describe');
  const [description, setDescription] = useState('');
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'project' | 'global'>('project');
  const [includeScripts, setIncludeScripts] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const projects = useWorkspaceStore((s) => s.projects);
  const hasProject = projects.length > 0;

  const reset = () => {
    setStep('describe');
    setDescription('');
    setName('');
    setScope('project');
    setIncludeScripts(false);
    setIsCreating(false);
  };

  const handleClose = () => {
    reset();
    onOpenChange(false);
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

      // Generate and write SKILL.md
      const frontmatter = [
        '---',
        `name: ${name}`,
        `description: ${description}`,
        'user-invocable: true',
        '---',
      ].join('\n');

      const body = `\n# ${name}\n\nTODO — Write instructions for how the AI should use this skill.\n`;

      await invoke('write_file', {
        path: `${skillDir}/SKILL.md`,
        content: `${frontmatter}\n${body}`,
      });

      // Trigger rescan
      const baseDirs = new Set<string>();
      for (const skill of useSkillStore.getState().skills) {
        const parent = skill.path.substring(0, skill.path.lastIndexOf('/'));
        baseDirs.add(parent);
      }
      baseDirs.add(targetDir);
      await useSkillStore.getState().scanSkills(Array.from(baseDirs));

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
  const canProceedToName = description.trim().length > 0;
  const canProceedToScope = name.trim().length > 0 && !nameError;
  const canCreate = canProceedToScope;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create Skill</DialogTitle>
          <DialogDescription>
            {step === 'describe' && 'Describe what this skill should do.'}
            {step === 'name' && 'Choose a name for your skill.'}
            {step === 'scope' && 'Where should this skill be saved?'}
            {step === 'review' && 'Review and create your skill.'}
          </DialogDescription>
        </DialogHeader>

        {step === 'describe' && (
          <div className="space-y-3">
            <div>
              <Label htmlFor="skill-desc">Description</Label>
              <Textarea
                id="skill-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g., Proofread text for grammar and clarity"
                rows={3}
                className="mt-1.5"
                autoFocus
              />
            </div>
            <div className="flex items-center gap-3">
              <Switch
                checked={includeScripts}
                onCheckedChange={setIncludeScripts}
                id="include-scripts"
              />
              <Label htmlFor="include-scripts" className="text-sm">Include scripts directory</Label>
            </div>
          </div>
        )}

        {step === 'name' && (
          <div className="space-y-3">
            <div>
              <Label htmlFor="skill-name">Skill name</Label>
              <Input
                id="skill-name"
                value={name}
                onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                placeholder="e.g., proofread"
                className="mt-1.5 font-mono text-sm"
                autoFocus
              />
              {nameError && <p className="text-xs text-destructive mt-1">{nameError}</p>}
              <p className="text-xs text-muted-foreground mt-1">
                Lowercase letters, digits, and hyphens. 1-64 characters.
              </p>
            </div>
          </div>
        )}

        {step === 'scope' && (
          <div className="space-y-3">
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setScope('project')}
                disabled={!hasProject}
                className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors ${
                  scope === 'project'
                    ? 'border-foreground/30 bg-accent'
                    : 'border-border hover:border-muted-foreground'
                } ${!hasProject ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <div className="text-sm font-medium">This project</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Saved to <code className="text-[11px]">.notesage/skills/</code>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setScope('global')}
                className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors ${
                  scope === 'global'
                    ? 'border-foreground/30 bg-accent'
                    : 'border-border hover:border-muted-foreground'
                }`}
              >
                <div className="text-sm font-medium">Global</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Saved to <code className="text-[11px]">~/.notesage/skills/</code> — available in all projects
                </div>
              </button>
            </div>
          </div>
        )}

        {step === 'review' && (
          <div className="space-y-3">
            <div className="rounded-lg border border-border p-3 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Name</span>
                <span className="font-mono">{name}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Scope</span>
                <span>{scope === 'project' ? 'Project' : 'Global'}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Scripts</span>
                <span>{includeScripts ? 'Yes' : 'No'}</span>
              </div>
              <div className="text-sm">
                <span className="text-muted-foreground">Description</span>
                <p className="mt-0.5 text-xs">{description}</p>
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          {step !== 'describe' && (
            <Button
              variant="ghost"
              onClick={() => {
                const steps: Step[] = ['describe', 'name', 'scope', 'review'];
                const idx = steps.indexOf(step);
                if (idx > 0) setStep(steps[idx - 1]);
              }}
            >
              Back
            </Button>
          )}
          <div className="flex-1" />
          <Button variant="ghost" onClick={handleClose}>Cancel</Button>
          {step === 'describe' && (
            <Button
              disabled={!canProceedToName}
              onClick={() => {
                if (!name) setName(suggestName(description));
                setStep('name');
              }}
            >
              Next
            </Button>
          )}
          {step === 'name' && (
            <Button disabled={!canProceedToScope} onClick={() => setStep('scope')}>
              Next
            </Button>
          )}
          {step === 'scope' && (
            <Button onClick={() => setStep('review')}>Next</Button>
          )}
          {step === 'review' && (
            <Button disabled={!canCreate || isCreating} onClick={handleCreate}>
              {isCreating ? 'Creating...' : 'Create Skill'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
