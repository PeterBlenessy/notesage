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
import { useSkillStore, type SkillEntry } from '@/stores/skill-store';
import { tauriApi } from '@/lib/tauri';
import { parseFrontmatter, serializeFrontmatter } from '@/lib/frontmatter';
import { cn } from '@/lib/utils';
import { sourceLabel } from '@/components/settings/skills-settings-utils';
import { t } from '@/lib/i18n';

export function EditSkillDialog({ skill, open, onOpenChange }: {
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
      toast.error(t("skill.descRequired"));
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
          <DialogTitle>{t("skill.editTitle")}</DialogTitle>
          <DialogDescription>
            <code className="text-xs">{skill.name}</code> — {sourceLabel(skill.source)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 overflow-y-auto max-h-[60vh]">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{t("skill.description")}</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="text-sm resize-y"
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{t("skill.instructions")}</Label>
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
                  <Label className="text-xs text-muted-foreground">{t("skill.allowedTools")}</Label>
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
                    <p className="text-xs text-muted-foreground">{t("skill.showInSlashMenu")}</p>
                  </div>
                  <Switch checked={userInvocable} onCheckedChange={setUserInvocable} />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-sm">{t("skill.disableModelInvocation")}</Label>
                    <p className="text-xs text-muted-foreground">{t("skill.disableModelInvocationDesc")}</p>
                  </div>
                  <Switch checked={disableModelInvocation} onCheckedChange={setDisableModelInvocation} />
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("skill.cancel")}</Button>
          <Button onClick={handleSave} disabled={saving || !description.trim()}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
