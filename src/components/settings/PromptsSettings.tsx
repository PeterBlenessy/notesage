import { useState } from 'react';
import { useAIStore, type CustomPrompt } from '@/stores/ai-store';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Plus, Pencil, Trash2, Sparkles } from 'lucide-react';

export function PromptsSettings() {
  const { customPrompts, addCustomPrompt, updateCustomPrompt, deleteCustomPrompt } =
    useAIStore();

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<CustomPrompt | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    icon: '✨',
    template: '',
  });

  const handleCreatePrompt = () => {
    if (formData.name.trim() && formData.template.trim()) {
      addCustomPrompt({
        name: formData.name.trim(),
        icon: formData.icon || '✨',
        template: formData.template.trim(),
      });
      setFormData({ name: '', icon: '✨', template: '' });
      setIsCreateDialogOpen(false);
    }
  };

  const handleUpdatePrompt = () => {
    if (editingPrompt && formData.name.trim() && formData.template.trim()) {
      updateCustomPrompt(editingPrompt.id, {
        name: formData.name.trim(),
        icon: formData.icon || '✨',
        template: formData.template.trim(),
      });
      setEditingPrompt(null);
      setFormData({ name: '', icon: '✨', template: '' });
    }
  };

  const handleDeletePrompt = (id: string) => {
    setPendingDeleteId(id);
  };

  const handleConfirmDelete = () => {
    if (pendingDeleteId) {
      deleteCustomPrompt(pendingDeleteId);
      setPendingDeleteId(null);
    }
  };

  const pendingPrompt = customPrompts.find((p) => p.id === pendingDeleteId);

  const openEditDialog = (prompt: CustomPrompt) => {
    setEditingPrompt(prompt);
    setFormData({
      name: prompt.name,
      icon: prompt.icon,
      template: prompt.template,
    });
  };

  const closeDialog = () => {
    setEditingPrompt(null);
    setFormData({ name: '', icon: '✨', template: '' });
    setIsCreateDialogOpen(false);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-3">
        <div>
          <Label className="text-sm font-semibold">Custom Prompts</Label>
          <p className="text-xs text-muted-foreground mt-1">
            Create reusable prompt templates for common AI tasks
          </p>
        </div>
      </div>

      {/* Info Card */}
      <div className="p-4 rounded-lg border border-border/50 bg-accent/20">
        <p className="text-sm text-muted-foreground">
          <strong className="text-foreground">Tip:</strong> Use{' '}
          <code className="px-1.5 py-0.5 rounded bg-muted text-xs font-mono">
            {'{{selection}}'}
          </code>{' '}
          in your template to insert the selected text. For example:{' '}
          <code className="px-1.5 py-0.5 rounded bg-muted text-xs font-mono">
            Translate the following to Spanish: {'{{selection}}'}
          </code>
        </p>
      </div>

      {/* Custom Prompts List */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Label className="text-sm font-semibold">Your Prompts</Label>
            <p className="text-xs text-muted-foreground mt-1">
              Reusable templates that appear in the AI actions menu
            </p>
          </div>
          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="ghost" size="sm" className="ml-auto">
                <Plus className="h-3.5 w-3.5 mr-1" strokeWidth={1.5} />
                Add
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Create Custom Prompt</DialogTitle>
                <DialogDescription>
                  Define a reusable prompt template for AI actions
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="prompt-icon">Icon (emoji)</Label>
                  <Input
                    id="prompt-icon"
                    value={formData.icon}
                    onChange={(e) => setFormData({ ...formData, icon: e.target.value })}
                    placeholder="✨"
                    className="text-2xl h-12"
                    maxLength={2}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="prompt-name">Prompt Name</Label>
                  <Input
                    id="prompt-name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="e.g., Translate to Spanish"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="prompt-template">Prompt Template</Label>
                  <Textarea
                    id="prompt-template"
                    value={formData.template}
                    onChange={(e) =>
                      setFormData({ ...formData, template: e.target.value })
                    }
                    placeholder="e.g., Translate the following to Spanish:\n\n{{selection}}\n\nProvide only the translation."
                    className="min-h-40 resize-none font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground">
                    Use{' '}
                    <code className="px-1 py-0.5 rounded bg-muted">{'{{selection}}'}</code>{' '}
                    to insert the selected text
                  </p>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={closeDialog}>
                  Cancel
                </Button>
                <Button onClick={handleCreatePrompt}>Add</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {customPrompts.length > 0 ? (
          <div className="space-y-2">
            {customPrompts.map((prompt) => (
              <div
                key={prompt.id}
                className="flex items-start gap-3 p-4 rounded-lg border border-border transition-all hover:border-primary/50"
              >
                <span className="text-2xl shrink-0">{prompt.icon}</span>
                <div className="flex-1 min-w-0">
                  <span className="font-medium text-sm block">{prompt.name}</span>
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2 font-mono">
                    {prompt.template}
                  </p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Dialog
                    open={editingPrompt?.id === prompt.id}
                    onOpenChange={(open) => !open && closeDialog()}
                  >
                    <DialogTrigger asChild>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openEditDialog(prompt)}
                        className="h-8 w-8 p-0 hover:bg-accent"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-lg">
                      <DialogHeader>
                        <DialogTitle>Edit Prompt</DialogTitle>
                        <DialogDescription>Modify the prompt template</DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <div className="space-y-2">
                          <Label htmlFor="edit-prompt-icon">Icon (emoji)</Label>
                          <Input
                            id="edit-prompt-icon"
                            value={formData.icon}
                            onChange={(e) =>
                              setFormData({ ...formData, icon: e.target.value })
                            }
                            placeholder="✨"
                            className="text-2xl h-12"
                            maxLength={2}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="edit-prompt-name">Prompt Name</Label>
                          <Input
                            id="edit-prompt-name"
                            value={formData.name}
                            onChange={(e) =>
                              setFormData({ ...formData, name: e.target.value })
                            }
                            placeholder="e.g., Translate to Spanish"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="edit-prompt-template">Prompt Template</Label>
                          <Textarea
                            id="edit-prompt-template"
                            value={formData.template}
                            onChange={(e) =>
                              setFormData({ ...formData, template: e.target.value })
                            }
                            placeholder="e.g., Translate the following to Spanish:\n\n{{selection}}\n\nProvide only the translation."
                            className="min-h-40 resize-none font-mono text-sm"
                          />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={closeDialog}>
                          Cancel
                        </Button>
                        <Button onClick={handleUpdatePrompt}>Save Changes</Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleDeletePrompt(prompt.id)}
                    className="h-8 w-8 p-0 hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-8 text-center border border-dashed border-border rounded-lg">
            <Sparkles className="h-12 w-12 mx-auto mb-3 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              No custom prompts yet. Create one to get started!
            </p>
          </div>
        )}
      </div>

      <AlertDialog
        open={pendingDeleteId !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete prompt?</AlertDialogTitle>
            <AlertDialogDescription>
              Delete &ldquo;{pendingPrompt?.name}&rdquo;? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
