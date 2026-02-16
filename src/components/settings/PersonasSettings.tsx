import { useState } from 'react';
import { useAIStore, BUILT_IN_PERSONAS, getAllPersonas, type AIPersona } from '@/stores/ai-store';
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { UserCircle2, Plus, Pencil, Trash2, Check, Sparkles, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export function PersonasSettings() {
  const {
    activePersonaId,
    customPersonas,
    setActivePersona,
    addCustomPersona,
    updateCustomPersona,
    deleteCustomPersona,
  } = useAIStore();

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editingPersona, setEditingPersona] = useState<AIPersona | null>(null);
  const [expandedPersonaId, setExpandedPersonaId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    icon: '🎭',
    systemMessage: '',
  });

  const allPersonas = getAllPersonas({ customPersonas } as any);
  const selectedPersona = allPersonas.find((p) => p.id === activePersonaId) || BUILT_IN_PERSONAS[0];

  const handleCreatePersona = () => {
    if (formData.name.trim() && formData.systemMessage.trim()) {
      addCustomPersona({
        name: formData.name.trim(),
        icon: formData.icon || '🎭',
        systemMessage: formData.systemMessage.trim(),
      });
      setFormData({ name: '', icon: '🎭', systemMessage: '' });
      setIsCreateDialogOpen(false);
    }
  };

  const handleUpdatePersona = () => {
    if (editingPersona && formData.name.trim() && formData.systemMessage.trim()) {
      updateCustomPersona(editingPersona.id, {
        name: formData.name.trim(),
        icon: formData.icon || '🎭',
        systemMessage: formData.systemMessage.trim(),
      });
      setEditingPersona(null);
      setFormData({ name: '', icon: '🎭', systemMessage: '' });
    }
  };

  const handleDeletePersona = (id: string) => {
    if (confirm('Are you sure you want to delete this persona?')) {
      deleteCustomPersona(id);
      if (activePersonaId === id) {
        setActivePersona('general');
      }
    }
  };

  const openEditDialog = (persona: AIPersona) => {
    setEditingPersona(persona);
    setFormData({
      name: persona.name,
      icon: persona.icon,
      systemMessage: persona.systemMessage,
    });
  };

  const closeDialog = () => {
    setEditingPersona(null);
    setFormData({ name: '', icon: '🎭', systemMessage: '' });
    setIsCreateDialogOpen(false);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-3">
        <div>
          <Label className="text-sm font-semibold">AI Personas</Label>
          <p className="text-xs text-muted-foreground mt-1">
            Configure the tone and expertise of your AI assistant
          </p>
        </div>
      </div>

      {/* Built-in Personas */}
      <div className="space-y-4">
        <Label className="text-sm font-medium">Built-in Personas</Label>
        <div className="space-y-2">
          {BUILT_IN_PERSONAS.map((persona) => {
            const isExpanded = expandedPersonaId === persona.id;
            const isActive = activePersonaId === persona.id;

            return (
              <Collapsible
                key={persona.id}
                open={isExpanded}
                onOpenChange={(open) => setExpandedPersonaId(open ? persona.id : null)}
              >
                <div
                  className={cn(
                    'rounded-md border transition-all overflow-hidden',
                    isActive
                      ? 'border-foreground/30 bg-accent'
                      : 'border-border hover:border-foreground/20 hover:bg-accent/50'
                  )}
                >
                  <div className="flex items-center gap-3 px-3 py-2">
                    <button
                      onClick={() => setActivePersona(persona.id)}
                      className="flex items-center gap-3 flex-1 text-left"
                    >
                      <span className="text-2xl shrink-0">{persona.icon}</span>
                      <span className="font-medium text-sm flex-1">{persona.name}</span>
                      {isActive && (
                        <Check className="h-4 w-4 text-primary shrink-0" />
                      )}
                    </button>
                    <CollapsibleTrigger className="cursor-pointer">
                      <ChevronDown
                        className={cn(
                          'h-4 w-4 transition-transform duration-200 text-muted-foreground',
                          isExpanded && 'rotate-180'
                        )}
                      />
                    </CollapsibleTrigger>
                  </div>
                  <CollapsibleContent className="animate-in slide-in-from-top-2 data-[state=closed]:animate-out data-[state=closed]:slide-out-to-top-2">
                    <div className="px-3 pb-3 pt-0 border-t border-border/50 mt-2">
                      <div className="pt-3 space-y-2">
                        <Label className="text-xs font-medium text-muted-foreground">
                          System Message:
                        </Label>
                        <p className="text-sm text-foreground leading-relaxed">
                          {persona.systemMessage}
                        </p>
                      </div>
                    </div>
                  </CollapsibleContent>
                </div>
              </Collapsible>
            );
          })}
        </div>
      </div>

      {/* Custom Personas */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Label className="text-sm font-medium">Custom Personas</Label>
            <p className="text-xs text-muted-foreground mt-1">
              Create your own personas with custom system messages
            </p>
          </div>
          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button
                size="sm"
                className="ml-auto transition-colors"
              >
                <Plus className="h-4 w-4 mr-1" />
                Create Persona
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Create Custom Persona</DialogTitle>
                <DialogDescription>
                  Define a custom AI persona with specific tone and expertise
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="persona-icon">Icon (emoji)</Label>
                  <Input
                    id="persona-icon"
                    value={formData.icon}
                    onChange={(e) => setFormData({ ...formData, icon: e.target.value })}
                    placeholder="🎭"
                    className="text-2xl h-12"
                    maxLength={2}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="persona-name">Persona Name</Label>
                  <Input
                    id="persona-name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="e.g., Poetry Writer"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="persona-system-message">System Message</Label>
                  <Textarea
                    id="persona-system-message"
                    value={formData.systemMessage}
                    onChange={(e) =>
                      setFormData({ ...formData, systemMessage: e.target.value })
                    }
                    placeholder="Describe the persona's role, tone, and expertise..."
                    className="min-h-32 resize-none"
                  />
                  <p className="text-xs text-muted-foreground">
                    This message defines how the AI will behave and respond
                  </p>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={closeDialog}>
                  Cancel
                </Button>
                <Button onClick={handleCreatePersona}>Create Persona</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>


        {customPersonas.length > 0 ? (
          <div className="space-y-2">
            {customPersonas.map((persona) => {
              const isExpanded = expandedPersonaId === persona.id;
              const isActive = activePersonaId === persona.id;

              return (
                <Collapsible
                  key={persona.id}
                  open={isExpanded}
                  onOpenChange={(open) => setExpandedPersonaId(open ? persona.id : null)}
                >
                  <div
                    className={cn(
                      'rounded-md border transition-all overflow-hidden',
                      isActive
                        ? 'border-primary/60 bg-primary/5'
                        : 'border-border/50 hover:border-primary/40'
                    )}
                  >
                    <div className="flex items-center gap-3 px-3 py-2">
                      <button
                        onClick={() => setActivePersona(persona.id)}
                        className="flex items-center gap-3 flex-1 text-left"
                      >
                        <span className="text-2xl shrink-0">{persona.icon}</span>
                        <span className="font-medium text-sm flex-1">{persona.name}</span>
                        {isActive && (
                          <Check className="h-4 w-4 text-primary shrink-0" />
                        )}
                      </button>
                      <div className="flex gap-1 shrink-0">
                        <Dialog
                          open={editingPersona?.id === persona.id}
                          onOpenChange={(open) => !open && closeDialog()}
                        >
                          <DialogTrigger asChild>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => openEditDialog(persona)}
                              className="h-8 w-8 p-0 hover:bg-accent"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="max-w-lg">
                            <DialogHeader>
                              <DialogTitle>Edit Persona</DialogTitle>
                              <DialogDescription>
                                Modify the persona's properties
                              </DialogDescription>
                            </DialogHeader>
                            <div className="space-y-4 py-4">
                              <div className="space-y-2">
                                <Label htmlFor="edit-persona-icon">Icon (emoji)</Label>
                                <Input
                                  id="edit-persona-icon"
                                  value={formData.icon}
                                  onChange={(e) =>
                                    setFormData({ ...formData, icon: e.target.value })
                                  }
                                  placeholder="🎭"
                                  className="text-2xl h-12"
                                  maxLength={2}
                                />
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor="edit-persona-name">Persona Name</Label>
                                <Input
                                  id="edit-persona-name"
                                  value={formData.name}
                                  onChange={(e) =>
                                    setFormData({ ...formData, name: e.target.value })
                                  }
                                  placeholder="e.g., Poetry Writer"
                                />
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor="edit-persona-system-message">
                                  System Message
                                </Label>
                                <Textarea
                                  id="edit-persona-system-message"
                                  value={formData.systemMessage}
                                  onChange={(e) =>
                                    setFormData({
                                      ...formData,
                                      systemMessage: e.target.value,
                                    })
                                  }
                                  placeholder="Describe the persona's role, tone, and expertise..."
                                  className="min-h-32 resize-none"
                                />
                              </div>
                            </div>
                            <DialogFooter>
                              <Button variant="outline" onClick={closeDialog}>
                                Cancel
                              </Button>
                              <Button onClick={handleUpdatePersona}>Save Changes</Button>
                            </DialogFooter>
                          </DialogContent>
                        </Dialog>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDeletePersona(persona.id)}
                          className="h-8 w-8 p-0 hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                        <CollapsibleTrigger className="cursor-pointer">
                          <ChevronDown
                            className={cn(
                              'h-4 w-4 transition-transform duration-200 text-muted-foreground',
                              isExpanded && 'rotate-180'
                            )}
                          />
                        </CollapsibleTrigger>
                      </div>
                    </div>
                    <CollapsibleContent className="animate-in slide-in-from-top-2 data-[state=closed]:animate-out data-[state=closed]:slide-out-to-top-2">
                      <div className="px-3 pb-3 pt-0 border-t border-border/50 mt-2">
                        <div className="pt-3 space-y-2">
                          <Label className="text-xs font-medium text-muted-foreground">
                            System Message:
                          </Label>
                          <p className="text-sm text-foreground leading-relaxed">
                            {persona.systemMessage}
                          </p>
                        </div>
                      </div>
                    </CollapsibleContent>
                  </div>
                </Collapsible>
              );
            })}
          </div>
        ) : (
          <div className="p-8 text-center border border-dashed border-border rounded-lg">
            <Sparkles className="h-12 w-12 mx-auto mb-3 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              No custom personas yet. Create one to get started!
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
