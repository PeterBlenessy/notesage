import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
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
import { useSkillStore } from '@/stores/skill-store';
import { tauriApi } from '@/lib/tauri';
import { serializeFrontmatter } from '@/lib/frontmatter';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

export function NewAddressableAgentDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
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
      toast.error(t("agent.nameAndDescRequired"));
      return;
    }
    if (!slug) {
      toast.error(t("agent.nameNeedsAlnum"));
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
          <DialogTitle>{t("agent.newTitle")}</DialogTitle>
          <DialogDescription>{t("agent.newSubtitle")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 overflow-y-auto max-h-[60vh]">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{t("agent.name")}</Label>
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
            <Label className="text-xs text-muted-foreground">{t("agent.description")}</Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("agent.descPlaceholder")}
              className="text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{t("agent.instructions")}</Label>
            <Textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder={t("agent.instructionsPlaceholder")}
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
                  <Label className="text-xs text-muted-foreground">{t("agent.allowedTools")}</Label>
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
                  <Label className="text-xs text-muted-foreground">{t("agent.modelPreference")}</Label>
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
                  <Label className="text-xs text-muted-foreground">{t("agent.icon")}</Label>
                  <Input
                    value={icon}
                    onChange={(e) => setIcon(e.target.value)}
                    placeholder={t("agent.iconPlaceholderLong")}
                    className="text-sm"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-sm">User-invocable</Label>
                    <p className="text-xs text-muted-foreground">{t("agent.showInPicker")}</p>
                  </div>
                  <Switch checked={userInvocable} onCheckedChange={setUserInvocable} />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-sm">{t("agent.disableModelInvocation")}</Label>
                    <p className="text-xs text-muted-foreground">{t("agent.disableModelInvocationDesc")}</p>
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
