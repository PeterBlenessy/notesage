import { ChevronDown } from 'lucide-react';
import { useState, useEffect } from 'react';
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
import { useSkillStore, type AgentEntry } from '@/stores/skill-store';
import { tauriApi } from '@/lib/tauri';
import { parseFrontmatter, serializeFrontmatter } from '@/lib/frontmatter';
import { cn } from '@/lib/utils';
import { sourceLabel } from '@/components/settings/skills-settings-utils';

export function EditAgentDialog({ agent, open, onOpenChange }: {
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
