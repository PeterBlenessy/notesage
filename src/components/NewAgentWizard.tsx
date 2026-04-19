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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useSkillStore } from '@/stores/skill-store';

interface NewAgentWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Step = 'describe' | 'scope' | 'review';

export function NewAgentWizard({ open, onOpenChange }: NewAgentWizardProps) {
  const [step, setStep] = useState<Step>('describe');
  const [description, setDescription] = useState('');
  const [scope, setScope] = useState<'project' | 'global'>('project');
  const [appendMode, setAppendMode] = useState(false);
  const [existingContent, setExistingContent] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const projects = useWorkspaceStore((s) => s.projects);
  const hasProject = projects.length > 0;

  const reset = () => {
    setStep('describe');
    setDescription('');
    setScope('project');
    setAppendMode(false);
    setExistingContent(null);
    setIsCreating(false);
  };

  const handleClose = () => {
    reset();
    onOpenChange(false);
  };

  const getTargetPath = async (): Promise<string> => {
    if (scope === 'project' && hasProject) {
      return `${projects[0].path}/.notesage/agents.md`;
    }
    const home = await invoke<string>('get_home_dir');
    return `${home}/.notesage/agents.md`;
  };

  const checkExistingFile = async () => {
    const targetPath = await getTargetPath();
    try {
      const exists = await invoke<boolean>('path_exists', { path: targetPath });
      if (exists) {
        const content = await invoke<string>('read_file', { path: targetPath });
        setExistingContent(content);
        return true;
      }
    } catch {
      // File doesn't exist
    }
    setExistingContent(null);
    return false;
  };

  const handleProceedToScope = async () => {
    setStep('scope');
  };

  const handleProceedToReview = async () => {
    await checkExistingFile();
    setStep('review');
  };

  const handleCreate = async () => {
    setIsCreating(true);
    try {
      const targetPath = await getTargetPath();

      // Ensure parent directory exists
      const parentDir = targetPath.substring(0, targetPath.lastIndexOf('/'));
      await invoke('create_directory', { path: parentDir });

      let content: string;
      if (existingContent && appendMode) {
        content = `${existingContent.trimEnd()}\n\n${description.trim()}\n`;
      } else {
        content = `# Agent Instructions\n\n${description.trim()}\n`;
      }

      await invoke('write_file', { path: targetPath, content });

      // Trigger rescan of agent instructions
      const projectRoots = projects.map((p) => p.path);
      await useSkillStore.getState().scanAgentInstructions(projectRoots, []);

      toast.success('Agent instructions saved', {
        description: scope === 'project' ? '.notesage/agents.md' : '~/.notesage/agents.md',
      });

      handleClose();
    } catch (e) {
      toast.error(`Failed to save agent instructions: ${e}`);
    } finally {
      setIsCreating(false);
    }
  };

  const canProceedToScope = description.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create Agent Instructions</DialogTitle>
          <DialogDescription>
            {step === 'describe' && 'Describe how the AI should behave.'}
            {step === 'scope' && 'Where should these instructions be saved?'}
            {step === 'review' && 'Review and save your instructions.'}
          </DialogDescription>
        </DialogHeader>

        {step === 'describe' && (
          <div className="space-y-3">
            <div>
              <Label htmlFor="agent-desc">Instructions</Label>
              <Textarea
                id="agent-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g., Always respond in a formal academic tone. When reviewing code, check for security issues first."
                rows={5}
                className="mt-1.5"
                autoFocus
              />
              <p className="text-xs text-muted-foreground mt-1">
                These instructions will be injected into all AI conversations.
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
                  Saved to <code className="text-[11px]">.notesage/agents.md</code>
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
                  Saved to <code className="text-[11px]">~/.notesage/agents.md</code> — applies to all projects
                </div>
              </button>
            </div>
          </div>
        )}

        {step === 'review' && (
          <div className="space-y-3">
            {existingContent && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  An agent instructions file already exists at this location.
                </p>
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => setAppendMode(true)}
                    className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
                      appendMode
                        ? 'border-foreground/30 bg-accent'
                        : 'border-border hover:border-muted-foreground'
                    }`}
                  >
                    <div className="text-sm font-medium">Append</div>
                    <div className="text-xs text-muted-foreground">Add to existing instructions</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setAppendMode(false)}
                    className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
                      !appendMode
                        ? 'border-foreground/30 bg-accent'
                        : 'border-border hover:border-muted-foreground'
                    }`}
                  >
                    <div className="text-sm font-medium">Replace</div>
                    <div className="text-xs text-muted-foreground">Overwrite with new instructions</div>
                  </button>
                </div>
              </div>
            )}
            <div className="rounded-lg border border-border p-3">
              <div className="text-xs text-muted-foreground mb-1">Preview</div>
              <pre className="text-xs whitespace-pre-wrap max-h-32 overflow-y-auto thin-scrollbar">
                {existingContent && appendMode
                  ? `${existingContent.trimEnd()}\n\n${description.trim()}`
                  : `# Agent Instructions\n\n${description.trim()}`}
              </pre>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          {step !== 'describe' && (
            <Button
              variant="ghost"
              onClick={() => {
                const steps: Step[] = ['describe', 'scope', 'review'];
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
            <Button disabled={!canProceedToScope} onClick={handleProceedToScope}>
              Next
            </Button>
          )}
          {step === 'scope' && (
            <Button onClick={handleProceedToReview}>Next</Button>
          )}
          {step === 'review' && (
            <Button disabled={isCreating} onClick={handleCreate}>
              {isCreating ? 'Saving...' : 'Save Instructions'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
