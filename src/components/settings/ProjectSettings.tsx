import { useProjectMetadataStore } from '@/stores/project-metadata-store';
import { useAIStore, getAllPersonas } from '@/stores/ai-store';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { AIProviderType } from '@/lib/ai/types';
import { PersonaIcon } from '@/components/PersonaIcon';

const PROVIDERS = [
  {
    value: 'anthropic',
    label: 'Anthropic Claude',
    logo: '/logos/anthropic.svg',
  },
  {
    value: 'openai',
    label: 'OpenAI',
    logo: '/logos/openai.svg',
  },
  {
    value: 'ollama',
    label: 'Ollama',
    logo: '/logos/ollama-official.png',
  },
];

interface ProjectSettingsProps {
  projectPath: string;
}

export function ProjectSettings({ projectPath }: ProjectSettingsProps) {
  const metadata = useProjectMetadataStore((s) => s.metadataMap[projectPath]);
  const { updateMetadata, updateAI } = useProjectMetadataStore();
  const aiStore = useAIStore();

  if (!metadata) {
    return (
      <div className="p-8 text-center border border-dashed border-border rounded-lg">
        <p className="text-sm text-muted-foreground">
          Loading project metadata...
        </p>
      </div>
    );
  }

  const allPersonas = getAllPersonas(aiStore);
  const selectedProvider = PROVIDERS.find((p) => p.value === metadata.ai.provider);

  return (
    <div className="space-y-6">
      {/* Project Info */}
      <div className="space-y-4">
        <div>
          <Label className="text-sm font-semibold">Project Info</Label>
          <p className="text-xs text-muted-foreground mt-1">
            Basic information about this project
          </p>
        </div>

        <div className="space-y-2">
          <div
            className="px-4 py-3 rounded-lg border transition-colors"
            style={{ borderColor: 'var(--color-border)' }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--color-muted-foreground)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--color-border)'; }}
          >
            <Label htmlFor="project-name" className="text-[13px] font-medium">
              Project Name
            </Label>
            <p className="text-xs text-muted-foreground mt-0.5 mb-2">
              Displayed in the sidebar header
            </p>
            <Input
              id="project-name"
              value={metadata.name}
              onChange={(e) => updateMetadata(projectPath, { name: e.target.value })}
              placeholder="My Project"
              className="text-sm transition-all hover:border-foreground/20 focus:border-foreground/40"
            />
          </div>

          <div
            className="px-4 py-3 rounded-lg border transition-colors"
            style={{ borderColor: 'var(--color-border)' }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--color-muted-foreground)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--color-border)'; }}
          >
            <Label htmlFor="project-description" className="text-[13px] font-medium">
              Description
            </Label>
            <p className="text-xs text-muted-foreground mt-0.5 mb-2">
              A short description of this project
            </p>
            <Input
              id="project-description"
              value={metadata.description}
              onChange={(e) => updateMetadata(projectPath, { description: e.target.value })}
              placeholder="Optional project description"
              className="text-sm transition-all hover:border-foreground/20 focus:border-foreground/40"
            />
          </div>
        </div>
      </div>

      <div className="h-px" style={{ backgroundColor: 'var(--color-border)' }} />

      {/* AI Overrides */}
      <div className="space-y-4">
        <div>
          <Label className="text-sm font-semibold">AI Overrides</Label>
          <p className="text-xs text-muted-foreground mt-1">
            Override global AI settings for this project only
          </p>
        </div>

        <div className="space-y-2">
          {/* Provider Override */}
          <div
            className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-lg border transition-colors"
            style={{ borderColor: 'var(--color-border)' }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--color-muted-foreground)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--color-border)'; }}
          >
            <div>
              <Label className="text-[13px] font-medium">Provider</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Override the global AI provider for this project
              </p>
            </div>
            <Select
              value={metadata.ai.provider || '_global'}
              onValueChange={(value) =>
                updateAI(projectPath, { provider: value === '_global' ? null : (value as AIProviderType) })
              }
            >
              <SelectTrigger className="ml-auto w-56 text-left">
                <SelectValue>
                  {metadata.ai.provider === null ? (
                    <span className="text-muted-foreground">Use Global Default</span>
                  ) : selectedProvider ? (
                    <div className="flex items-center gap-2">
                      <img
                        src={selectedProvider.logo}
                        alt={selectedProvider.label}
                        className="w-4 h-4 rounded object-contain bg-white p-0.5"
                      />
                      <span>{selectedProvider.label}</span>
                    </div>
                  ) : null}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_global">
                  <span className="text-muted-foreground">Use Global Default</span>
                </SelectItem>
                {PROVIDERS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    <div className="flex items-center gap-2">
                      <img
                        src={p.logo}
                        alt={p.label}
                        className="w-4 h-4 rounded object-contain bg-white p-0.5"
                      />
                      <span>{p.label}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Persona Override */}
          <div
            className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-lg border transition-colors"
            style={{ borderColor: 'var(--color-border)' }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--color-muted-foreground)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--color-border)'; }}
          >
            <div>
              <Label className="text-[13px] font-medium">Persona</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Override the global AI persona for this project
              </p>
            </div>
            <Select
              value={metadata.ai.personaId || '_global'}
              onValueChange={(value) =>
                updateAI(projectPath, { personaId: value === '_global' ? null : value })
              }
            >
              <SelectTrigger className="ml-auto w-56 text-left">
                <SelectValue>
                  {metadata.ai.personaId === null ? (
                    <span className="text-muted-foreground">Use Global Default</span>
                  ) : (() => {
                    const p = allPersonas.find((p) => p.id === metadata.ai.personaId);
                    return p ? (
                      <span className="flex items-center gap-2">
                        <PersonaIcon persona={p} size={14} />
                        {p.name}
                      </span>
                    ) : null;
                  })()}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_global">
                  <span className="text-muted-foreground">Use Global Default</span>
                </SelectItem>
                {allPersonas.map((persona) => (
                  <SelectItem key={persona.id} value={persona.id}>
                    <span className="flex items-center gap-2">
                      <PersonaIcon persona={persona} size={14} />
                      {persona.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Project Context */}
          <div
            className="px-4 py-3 rounded-lg border transition-colors"
            style={{ borderColor: 'var(--color-border)' }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--color-muted-foreground)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--color-border)'; }}
          >
            <Label htmlFor="project-context" className="text-[13px] font-medium">
              Project Context
            </Label>
            <p className="text-xs text-muted-foreground mt-0.5 mb-2">
              Additional context prepended to all AI system messages for this project
            </p>
            <Textarea
              id="project-context"
              value={metadata.ai.projectContext}
              onChange={(e) => updateAI(projectPath, { projectContext: e.target.value })}
              placeholder="e.g., This is a Rust systems programming project. Use technical language and provide code examples in Rust."
              rows={4}
              className="text-sm resize-none transition-all hover:border-foreground/20 focus:border-foreground/40"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
