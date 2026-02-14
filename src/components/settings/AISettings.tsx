import { useState } from 'react';
import { useAIStore } from '@/stores/ai-store';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Sparkles, Check, X, Loader2, AlertCircle } from 'lucide-react';
import type { AIProviderType } from '@/lib/ai/types';

export function AISettings() {
  const {
    provider,
    apiKeys,
    ollamaUrl,
    suggestionsEnabled,
    setProvider,
    setApiKey,
    setOllamaUrl,
    toggleSuggestions,
  } = useAIStore();

  const [anthropicKey, setAnthropicKey] = useState(apiKeys.anthropic || '');
  const [openaiKey, setOpenaiKey] = useState(apiKeys.openai || '');
  const [localOllamaUrl, setLocalOllamaUrl] = useState(ollamaUrl);
  const [testStatus, setTestStatus] = useState<{
    type: 'success' | 'error' | 'info' | null;
    message: string;
  }>({ type: null, message: '' });
  const [isTesting, setIsTesting] = useState(false);

  const handleSaveAnthropicKey = () => {
    if (anthropicKey.trim()) {
      setApiKey('anthropic', anthropicKey.trim());
      setTestStatus({ type: 'success', message: 'API key saved successfully' });
      setTimeout(() => setTestStatus({ type: null, message: '' }), 3000);
    }
  };

  const handleSaveOpenAIKey = () => {
    if (openaiKey.trim()) {
      setApiKey('openai', openaiKey.trim());
      setTestStatus({ type: 'success', message: 'API key saved successfully' });
      setTimeout(() => setTestStatus({ type: null, message: '' }), 3000);
    }
  };

  const handleSaveOllamaUrl = () => {
    if (localOllamaUrl.trim()) {
      setOllamaUrl(localOllamaUrl.trim());
      setTestStatus({ type: 'success', message: 'Ollama URL saved successfully' });
      setTimeout(() => setTestStatus({ type: null, message: '' }), 3000);
    }
  };

  const handleTestConnection = async () => {
    if (!provider) {
      setTestStatus({ type: 'error', message: 'Please select a provider first' });
      return;
    }

    setIsTesting(true);
    setTestStatus({ type: 'info', message: 'Testing connection...' });

    try {
      const { getAIProvider } = await import('@/lib/ai');
      const aiProvider = getAIProvider(
        provider,
        provider === 'ollama' ? undefined : apiKeys[provider],
        ollamaUrl
      );

      await aiProvider.generateText('Say "Hello" in one word');
      setTestStatus({
        type: 'success',
        message: `Successfully connected to ${provider}!`,
      });
    } catch (error) {
      setTestStatus({
        type: 'error',
        message: error instanceof Error ? error.message : 'Connection failed',
      });
    } finally {
      setIsTesting(false);
      setTimeout(() => setTestStatus({ type: null, message: '' }), 5000);
    }
  };

  const providers = [
    {
      value: 'anthropic',
      label: 'Anthropic Claude',
      description: 'Claude Sonnet 4.5 - Most capable',
      logo: '/logos/anthropic.svg',
    },
    {
      value: 'openai',
      label: 'OpenAI',
      description: 'GPT-4 Turbo - Fast and reliable',
      logo: '/logos/openai.svg',
    },
    {
      value: 'ollama',
      label: 'Ollama',
      description: 'Local AI - Privacy focused',
      logo: '/logos/ollama-official.png',
    },
  ];

  const selectedProvider = providers.find((p) => p.value === provider);

  return (
    <div className="space-y-6">
      {/* Provider Selection */}
      <div className="space-y-3">
        <div>
          <Label className="text-base font-semibold flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            AI Provider
          </Label>
          <p className="text-sm text-muted-foreground mt-1">
            Choose your preferred AI service
          </p>
        </div>

        <Select
          value={provider || ''}
          onValueChange={(value) => setProvider(value as AIProviderType)}
        >
          <SelectTrigger className="w-full h-12 text-left hover:bg-accent/50 transition-colors">
            <SelectValue placeholder="Select an AI provider...">
              {selectedProvider && (
                <div className="flex items-center gap-3">
                  <img
                    src={selectedProvider.logo}
                    alt={selectedProvider.label}
                    className="w-6 h-6 rounded object-contain bg-white p-0.5"
                  />
                  <div className="flex flex-col items-start">
                    <span className="font-medium">{selectedProvider.label}</span>
                    <span className="text-xs text-muted-foreground">
                      {selectedProvider.description}
                    </span>
                  </div>
                </div>
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {providers.map((p) => (
              <SelectItem
                key={p.value}
                value={p.value}
                className="cursor-pointer hover:bg-accent transition-colors"
              >
                <div className="flex items-center gap-3 py-1">
                  <img
                    src={p.logo}
                    alt={p.label}
                    className="w-6 h-6 rounded object-contain bg-white p-0.5"
                  />
                  <div className="flex flex-col">
                    <span className="font-medium">{p.label}</span>
                    <span className="text-xs text-muted-foreground">
                      {p.description}
                    </span>
                  </div>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Provider Configuration */}
      {provider && (
        <div className="space-y-4 animate-in fade-in-50 duration-300">
          <div className="h-px bg-border" />

          {/* Anthropic Configuration */}
          {provider === 'anthropic' && (
            <div className="space-y-4">
              <div>
                <Label htmlFor="anthropic-key" className="text-sm font-medium">
                  API Key
                </Label>
                <p className="text-xs text-muted-foreground mb-2">
                  Get your key from{' '}
                  <a
                    href="https://console.anthropic.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    console.anthropic.com
                  </a>
                </p>
                <div className="flex gap-2">
                  <Input
                    id="anthropic-key"
                    type="password"
                    placeholder="sk-ant-..."
                    value={anthropicKey}
                    onChange={(e) => setAnthropicKey(e.target.value)}
                    className="font-mono text-sm transition-all hover:border-primary/50 focus:border-primary"
                  />
                  <Button
                    onClick={handleSaveAnthropicKey}
                    size="sm"
                    className="hover:bg-primary/90 transition-all hover:scale-105"
                  >
                    <Check className="h-4 w-4 mr-1" />
                    Save
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* OpenAI Configuration */}
          {provider === 'openai' && (
            <div className="space-y-4">
              <div>
                <Label htmlFor="openai-key" className="text-sm font-medium">
                  API Key
                </Label>
                <p className="text-xs text-muted-foreground mb-2">
                  Get your key from{' '}
                  <a
                    href="https://platform.openai.com/api-keys"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    platform.openai.com
                  </a>
                </p>
                <div className="flex gap-2">
                  <Input
                    id="openai-key"
                    type="password"
                    placeholder="sk-..."
                    value={openaiKey}
                    onChange={(e) => setOpenaiKey(e.target.value)}
                    className="font-mono text-sm transition-all hover:border-primary/50 focus:border-primary"
                  />
                  <Button
                    onClick={handleSaveOpenAIKey}
                    size="sm"
                    className="hover:bg-primary/90 transition-all hover:scale-105"
                  >
                    <Check className="h-4 w-4 mr-1" />
                    Save
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Ollama Configuration */}
          {provider === 'ollama' && (
            <div className="space-y-4">
              <div>
                <Label htmlFor="ollama-url" className="text-sm font-medium">
                  Ollama Server URL
                </Label>
                <p className="text-xs text-muted-foreground mb-2">
                  Default: http://localhost:11434 (requires{' '}
                  <a
                    href="https://ollama.ai"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    Ollama
                  </a>{' '}
                  installed)
                </p>
                <div className="flex gap-2">
                  <Input
                    id="ollama-url"
                    type="text"
                    placeholder="http://localhost:11434"
                    value={localOllamaUrl}
                    onChange={(e) => setLocalOllamaUrl(e.target.value)}
                    className="font-mono text-sm transition-all hover:border-primary/50 focus:border-primary"
                  />
                  <Button
                    onClick={handleSaveOllamaUrl}
                    size="sm"
                    className="hover:bg-primary/90 transition-all hover:scale-105"
                  >
                    <Check className="h-4 w-4 mr-1" />
                    Save
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Test Connection */}
          <div className="pt-2">
            <Button
              onClick={handleTestConnection}
              disabled={isTesting}
              className="w-full h-11 hover:bg-primary/90 transition-all hover:scale-[1.02] active:scale-[0.98]"
              variant="default"
            >
              {isTesting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Testing Connection...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  Test Connection
                </>
              )}
            </Button>

            {testStatus.message && (
              <div
                className={`mt-3 p-3 rounded-lg flex items-center gap-2 text-sm animate-in fade-in-50 slide-in-from-top-2 ${
                  testStatus.type === 'success'
                    ? 'bg-primary/10 text-primary border border-primary/20'
                    : testStatus.type === 'error'
                    ? 'bg-destructive/10 text-destructive border border-destructive/20'
                    : 'bg-accent text-accent-foreground border border-border'
                }`}
              >
                {testStatus.type === 'success' && (
                  <Check className="h-4 w-4 shrink-0" />
                )}
                {testStatus.type === 'error' && <X className="h-4 w-4 shrink-0" />}
                {testStatus.type === 'info' && (
                  <AlertCircle className="h-4 w-4 shrink-0" />
                )}
                <span>{testStatus.message}</span>
              </div>
            )}
          </div>

          {/* Additional Options */}
          <div className="pt-2">
            <div className="h-px bg-border mb-4" />
            <div className="flex items-center justify-between p-4 rounded-lg border border-border hover:border-primary/50 transition-colors bg-card/50">
              <div>
                <Label
                  htmlFor="suggestions"
                  className="text-sm font-medium cursor-pointer"
                >
                  Inline AI Suggestions
                </Label>
                <p className="text-xs text-muted-foreground mt-1">
                  Show AI-powered suggestions while typing (coming soon)
                </p>
              </div>
              <Switch
                id="suggestions"
                checked={suggestionsEnabled}
                onCheckedChange={toggleSuggestions}
                className="data-[state=checked]:bg-primary"
              />
            </div>
          </div>
        </div>
      )}

      {!provider && (
        <div className="p-8 text-center border border-dashed border-border rounded-lg">
          <Sparkles className="h-12 w-12 mx-auto mb-3 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            Select an AI provider above to configure
          </p>
        </div>
      )}
    </div>
  );
}
