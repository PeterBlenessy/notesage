import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useLocalAIStore, type ModelCategory } from '@/stores/local-ai-store';
import { useConnectionsStore } from '@/stores/connections-store';
import { tauriApi } from '@/lib/tauri';
import type { LocalModelInfo, HfModelSearchResult, HfModelFile, HfModelDetails } from '@/lib/tauri';
import { useModelMetadata } from '@/hooks/useModelMetadata';
import { ModelMetadataTooltip } from './ModelMetadataTooltip';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Download, Trash2, X, Plus, Link, Shield, HeartPulse, Loader2, FolderOpen, Star, ArrowUpDown, Check, Search } from 'lucide-react';
import { toast } from 'sonner';

type ModelSort = 'name' | 'size' | 'ram';

function formatBytes(bytes: number): string {
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(0)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
}

function CapabilityBadge({ label }: { label: string }) {
  return (
    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
      {label}
    </span>
  );
}

function getRamTier(totalBytes: number): string {
  const gb = totalBytes / 1_000_000_000;
  if (gb <= 8) return '8gb';
  if (gb <= 16) return '16gb';
  if (gb <= 32) return '32gb';
  return '64gb';
}

function getDefaultModelId(ramTier: string): string {
  switch (ramTier) {
    case '8gb': return 'qwen3-1.7b';
    case '16gb': return 'qwen3-4b';
    case '32gb': return 'qwen3-8b';
    default: return 'qwen3-14b';
  }
}

const CATEGORY_TABS: { value: ModelCategory; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'general', label: 'General' },
  { value: 'code', label: 'Code' },
  { value: 'reasoning', label: 'Reasoning' },
  { value: 'downloaded', label: 'Downloaded' },
];

const SORT_OPTIONS: { value: ModelSort; label: string }[] = [
  { value: 'ram', label: 'RAM' },
  { value: 'size', label: 'Size' },
  { value: 'name', label: 'Name' },
];

function AddCustomModelDialog({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'search' | 'url'>('search');

  // Search tab state
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<HfModelSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState<HfModelSearchResult | null>(null);
  const [repoDetails, setRepoDetails] = useState<HfModelDetails | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Active filters (clickable badges)
  const [filterAuthor, setFilterAuthor] = useState<string | null>(null);
  const [filterCaps, setFilterCaps] = useState<Set<string>>(new Set());

  // URL tab state
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');

  const [loading, setLoading] = useState(false);
  const addCustomModel = useLocalAIStore((s) => s.addCustomModel);

  const doSearch = useCallback(async (q: string, author?: string | null) => {
    if (q.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const results = await tauriApi.searchHuggingfaceModels(q.trim(), 30, author || undefined);
      setSearchResults(results);
    } catch (err) {
      toast.error(`Search failed: ${err}`);
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  // Filtered results based on capability filters (applied client-side)
  const filteredResults = useMemo(() => {
    if (filterCaps.size === 0) return searchResults;
    return searchResults.filter((r) => {
      if (filterCaps.has('Vision') && !r.supports_vision) return false;
      if (filterCaps.has('Tools') && !r.supports_tool_calling) return false;
      if (filterCaps.has('Thinking') && !r.supports_thinking) return false;
      return true;
    });
  }, [searchResults, filterCaps]);

  const handleQueryChange = useCallback((value: string) => {
    setQuery(value);
    setSelectedRepo(null);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => doSearch(value, filterAuthor), 400);
  }, [doSearch, filterAuthor]);

  const toggleCapFilter = useCallback((cap: string) => {
    setFilterCaps((prev) => {
      const next = new Set(prev);
      if (next.has(cap)) next.delete(cap); else next.add(cap);
      return next;
    });
  }, []);

  const setAuthorFilter = useCallback((author: string | null) => {
    setFilterAuthor(author);
    // Re-search with the new author filter
    if (query.trim().length >= 2) {
      doSearch(query, author);
    }
  }, [doSearch, query]);

  const handleSelectRepo = useCallback(async (repo: HfModelSearchResult) => {
    setSelectedRepo(repo);
    setRepoDetails(null);
    setLoadingDetails(true);
    try {
      const details = await tauriApi.fetchHfModelDetails(repo.repo_id);
      setRepoDetails(details);
    } catch {
      // Fallback — use search data
    } finally {
      setLoadingDetails(false);
    }
  }, []);

  const handleAddFromSearch = async (file: HfModelFile) => {
    if (!selectedRepo) return;
    setLoading(true);
    try {
      const d = repoDetails;
      const r = selectedRepo;
      await addCustomModel(d?.model_name || r.model_name, file.download_url, {
        supportsToolCalling: d?.supports_tool_calling ?? r.supports_tool_calling,
        supportsThinking: d?.supports_thinking ?? r.supports_thinking,
        supportsVision: d?.supports_vision ?? r.supports_vision,
        multilingual: d?.multilingual ?? false,
        supportsFim: d?.supports_fim ?? false,
      });
      setQuery('');
      setSearchResults([]);
      setSelectedRepo(null);
      setRepoDetails(null);
      setOpen(false);
      onAdded();
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitUrl = async () => {
    if (!name.trim() || !url.trim()) {
      toast.error('Name and URL are required');
      return;
    }
    setLoading(true);
    try {
      await addCustomModel(name.trim(), url.trim());
      setName('');
      setUrl('');
      setOpen(false);
      onAdded();
    } finally {
      setLoading(false);
    }
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setQuery('');
      setSearchResults([]);
      setSelectedRepo(null);
      setRepoDetails(null);
      setFilterAuthor(null);
      setFilterCaps(new Set());
      setName('');
      setUrl('');
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          Add model
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg overflow-hidden">
        <DialogHeader>
          <DialogTitle className="text-sm">Add Model</DialogTitle>
          <DialogDescription className="text-xs">
            Search Hugging Face for GGUF models or paste a direct download URL.
          </DialogDescription>
        </DialogHeader>

        {/* Tab switcher */}
        <div className="flex gap-1 rounded-md bg-muted p-0.5">
          <button
            onClick={() => setTab('search')}
            className={`flex-1 text-xs font-medium py-1.5 rounded-sm transition-colors ${tab === 'search' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <Search className="inline h-3 w-3 mr-1 -mt-px" strokeWidth={1.5} />
            Search Hugging Face
          </button>
          <button
            onClick={() => setTab('url')}
            className={`flex-1 text-xs font-medium py-1.5 rounded-sm transition-colors ${tab === 'url' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <Link className="inline h-3 w-3 mr-1 -mt-px" strokeWidth={1.5} />
            Paste URL
          </button>
        </div>

        {tab === 'search' ? (
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.5} />
              <Input
                value={query}
                onChange={(e) => handleQueryChange(e.target.value)}
                placeholder="Search models... e.g. gemma-4, llama, qwen"
                className="h-8 text-sm pl-8"
                autoFocus
              />
              {searching && (
                <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground" />
              )}
            </div>

            {/* Active filter pills */}
            {(filterAuthor || filterCaps.size > 0) && (
              <div className="flex flex-wrap gap-1.5">
                {filterAuthor && (
                  <button
                    onClick={() => setAuthorFilter(null)}
                    className="group flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-muted text-foreground hover:bg-muted/80 transition-colors"
                  >
                    {filterAuthor}
                    <X className="h-2.5 w-2.5 opacity-0 group-hover:opacity-100 transition-opacity" strokeWidth={2} />
                  </button>
                )}
                {[...filterCaps].map((cap) => (
                  <button
                    key={cap}
                    onClick={() => toggleCapFilter(cap)}
                    className="group flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-muted text-foreground hover:bg-muted/80 transition-colors"
                  >
                    {cap}
                    <X className="h-2.5 w-2.5 opacity-0 group-hover:opacity-100 transition-opacity" strokeWidth={2} />
                  </button>
                ))}
              </div>
            )}

            {selectedRepo ? (
              /* Model detail + file picker */
              <div className="space-y-2">
                <button
                  onClick={() => { setSelectedRepo(null); setRepoDetails(null); }}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  &larr; Back to results
                </button>

                {/* Model info card */}
                <div className="rounded-lg border border-border p-3 space-y-1.5">
                  <div className="text-sm font-medium">{selectedRepo.model_name}</div>
                  {selectedRepo.base_model && (
                    <div className="text-[10px] text-muted-foreground">Base: {selectedRepo.base_model}</div>
                  )}
                  <div className="text-[10px] text-muted-foreground">
                    {selectedRepo.author}
                    {selectedRepo.license && <> &middot; {selectedRepo.license}</>}
                    {selectedRepo.architecture && <> &middot; {selectedRepo.architecture}</>}
                    {selectedRepo.context_length && <> &middot; {(selectedRepo.context_length / 1024).toFixed(0)}K context</>}
                    {selectedRepo.total_size && <> &middot; ~{formatBytes(selectedRepo.total_size)}</>}
                  </div>
                  <div className="flex flex-wrap gap-1 pt-0.5">
                    {selectedRepo.supports_vision && <span className="px-1.5 py-px rounded text-[9px] bg-muted text-muted-foreground">Vision</span>}
                    {selectedRepo.supports_tool_calling && <span className="px-1.5 py-px rounded text-[9px] bg-muted text-muted-foreground">Tools</span>}
                    {selectedRepo.supports_thinking && <span className="px-1.5 py-px rounded text-[9px] bg-muted text-muted-foreground">Thinking</span>}
                    {loadingDetails && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                  </div>
                </div>

                <p className="text-[10px] text-muted-foreground">
                  Pick a quantization. Q4_K_M is recommended for quality/size balance.
                </p>
                <ScrollArea className="h-[250px]">
                  <div className="space-y-1">
                    {(repoDetails?.files || selectedRepo.files)
                      .sort((a, b) => a.size_bytes - b.size_bytes)
                      .map((file) => (
                        <button
                          key={file.filename}
                          onClick={() => handleAddFromSearch(file)}
                          disabled={loading}
                          className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md text-left hover:bg-muted transition-colors disabled:opacity-50"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-medium truncate">
                              {file.quantization !== 'Unknown' ? file.quantization : file.filename.replace('.gguf', '')}
                            </div>
                            <div className="text-[10px] text-muted-foreground truncate">
                              {file.size_bytes > 0 && <>{formatBytes(file.size_bytes)} &middot; ~{formatBytes(Math.round(file.size_bytes * 1.1))} RAM</>}
                              {file.size_bytes > 0 && file.quantization !== 'Unknown' && <> &middot; </>}
                              {file.quantization !== 'Unknown' && <span className="opacity-60">{file.filename}</span>}
                            </div>
                          </div>
                          <Download className="h-3.5 w-3.5 text-muted-foreground shrink-0" strokeWidth={1.5} />
                        </button>
                      ))}
                  </div>
                </ScrollArea>
              </div>
            ) : (
              /* Search results list */
              <ScrollArea className="h-[400px]">
                <div className="space-y-0.5">
                  {filteredResults.map((result) => (
                    <div
                      key={result.repo_id}
                      className="flex items-start gap-2.5 px-2.5 py-2 rounded-md hover:bg-muted transition-colors overflow-hidden cursor-pointer"
                      onClick={() => handleSelectRepo(result)}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium truncate">{result.model_name}</div>
                        <div className="text-[10px] text-muted-foreground truncate">
                          <button
                            className="hover:text-foreground hover:underline transition-colors"
                            onClick={(e) => { e.stopPropagation(); setAuthorFilter(result.author); }}
                          >{result.author}</button>
                          {result.architecture && <> &middot; {result.architecture}</>}
                          {result.context_length && <> &middot; {(result.context_length / 1024).toFixed(0)}K ctx</>}
                          {result.total_size && <> &middot; ~{formatBytes(result.total_size)}</>}
                          {result.license && <> &middot; {result.license}</>}
                        </div>
                        <div className="text-[10px] text-muted-foreground/60 truncate">
                          {result.files.length} quant{result.files.length !== 1 ? 's' : ''}
                          {result.downloads > 0 && <> &middot; {Intl.NumberFormat('en', { notation: 'compact' }).format(result.downloads)} downloads</>}
                        </div>
                        {(result.supports_tool_calling || result.supports_thinking || result.supports_vision) && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {result.supports_vision && (
                              <button onClick={(e) => { e.stopPropagation(); toggleCapFilter('Vision'); }} className={`px-1 py-px rounded text-[9px] transition-colors ${filterCaps.has('Vision') ? 'bg-foreground/20 text-foreground' : 'bg-muted text-muted-foreground hover:bg-foreground/10'}`}>Vision</button>
                            )}
                            {result.supports_tool_calling && (
                              <button onClick={(e) => { e.stopPropagation(); toggleCapFilter('Tools'); }} className={`px-1 py-px rounded text-[9px] transition-colors ${filterCaps.has('Tools') ? 'bg-foreground/20 text-foreground' : 'bg-muted text-muted-foreground hover:bg-foreground/10'}`}>Tools</button>
                            )}
                            {result.supports_thinking && (
                              <button onClick={(e) => { e.stopPropagation(); toggleCapFilter('Thinking'); }} className={`px-1 py-px rounded text-[9px] transition-colors ${filterCaps.has('Thinking') ? 'bg-foreground/20 text-foreground' : 'bg-muted text-muted-foreground hover:bg-foreground/10'}`}>Thinking</button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  {!searching && query.trim().length >= 2 && filteredResults.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-4">
                      {searchResults.length > 0 ? 'No models match the active filters.' : 'No GGUF models found. Try a different search term.'}
                    </p>
                  )}
                  {!searching && query.trim().length < 2 && (
                    <p className="text-xs text-muted-foreground text-center py-4">
                      Type at least 2 characters to search.
                    </p>
                  )}
                </div>
              </ScrollArea>
            )}
          </div>
        ) : (
          /* URL tab — same as original */
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Model name</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Phi-4 Mini"
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">GGUF download URL</label>
              <div className="relative">
                <Link className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.5} />
                <Input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://huggingface.co/.../model.gguf"
                  className="h-8 text-sm pl-8"
                />
              </div>
              <p className="text-[10px] text-muted-foreground">
                Use Q4_K_M quantization for the best size/quality balance.
              </p>
            </div>
            <Button
              onClick={handleSubmitUrl}
              disabled={loading || !name.trim() || !url.trim()}
              className="w-full"
              size="sm"
            >
              {loading ? 'Adding...' : 'Add model'}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ModelCard({
  model,
  isActive,
  isRecommendedDefault,
  download,
  metadata,
  onSetActive,
  onDownload,
  onCancelDownload,
  onDelete,
  onRemoveCustom,
}: {
  model: LocalModelInfo;
  isActive: boolean;
  isRecommendedDefault: boolean;
  download: { progress: number } | undefined;
  metadata: import('@/lib/tauri').ModelMetadata | null | undefined;
  onSetActive: () => void;
  onDownload: () => void;
  onCancelDownload: () => void;
  onDelete: () => void;
  onRemoveCustom: () => void;
}) {
  return (
    <ModelMetadataTooltip metadata={metadata} modelType="llm" side="right">
      <div className="relative rounded-md border px-3 py-2.5">
        {/* Action buttons — top right */}
        <div className="absolute top-2 right-2 flex items-center gap-1">
          {download ? (
            <div className="flex items-center gap-2">
              <div className="w-16">
                <Progress value={download.progress} className="h-1.5" />
              </div>
              <span className="text-[10px] tabular-nums text-muted-foreground">
                {Math.round(download.progress)}%
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={onCancelDownload}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">Cancel download</TooltipContent>
              </Tooltip>
            </div>
          ) : model.downloaded ? (
            <>
              {!isActive && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 text-[11px] px-2"
                      onClick={onSetActive}
                    >
                      Use
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">Set as active model</TooltipContent>
                </Tooltip>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-destructive"
                    disabled={isActive}
                    onClick={onDelete}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {isActive ? 'Stop the model first' : 'Delete model file'}
                </TooltipContent>
              </Tooltip>
              {model.is_custom && !isActive && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground hover:text-destructive"
                      onClick={onRemoveCustom}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">Remove custom model</TooltipContent>
                </Tooltip>
              )}
            </>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-6 w-6"
                  onClick={onDownload}
                >
                  <Download className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">Download model</TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* Content */}
        <div className="pr-24">
          <div className="flex items-center gap-1.5 flex-wrap">
            {isRecommendedDefault && (
              <Star className="h-3 w-3 text-muted-foreground fill-muted-foreground" strokeWidth={1.5} />
            )}
            <span className="text-sm font-medium">{model.name}</span>
            <span className="text-[10px] text-muted-foreground/50">
              {model.size_bytes > 0 && formatBytes(model.size_bytes)}
              {model.size_bytes > 0 && model.ram_required_bytes > 0 && ' · '}
              {model.ram_required_bytes > 0 && `~${formatBytes(model.ram_required_bytes)} RAM`}
            </span>
            {isActive && model.downloaded && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                Active
              </span>
            )}
            {model.is_custom && (
              <CapabilityBadge label="Custom" />
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
            {model.description}
          </p>
          <div className="flex items-center gap-1 mt-1 flex-wrap">
            {model.supports_tool_calling && <CapabilityBadge label="Tools" />}
            {model.supports_thinking && <CapabilityBadge label="Think" />}
            {model.supports_fim && <CapabilityBadge label="FIM" />}
            {model.supports_vision && <CapabilityBadge label="Vision" />}
            {model.multilingual && <CapabilityBadge label="Multi" />}
          </div>
        </div>
      </div>
    </ModelMetadataTooltip>
  );
}

export function LocalAISettings() {
  const {
    activeModelId,
    serverStatus,
    serverError,
    models,
    downloads,
    systemMemory,
    binaryStatus,
    categoryFilter,
    setActiveModel,
    refreshModels,
    downloadModel,
    cancelDownload,
    deleteModel,
    removeCustomModel,
    checkBinary,
    startServer,
    setCategoryFilter,
  } = useLocalAIStore();

  const connections = useConnectionsStore((s) => s.connections);
  const hasConnection = connections.some(
    (c) => c.provider === 'local_ai' && c.authMethod === 'local_bundled'
  );

  const [healthChecking, setHealthChecking] = useState(false);
  const [sortBy, setSortBy] = useState<ModelSort>('ram');

  useEffect(() => {
    refreshModels();
    checkBinary();
    tauriApi.getSystemMemory().then((mem) => {
      useLocalAIStore.getState().setSystemMemory(mem);
    }).catch(() => {});
  }, [refreshModels, checkBinary]);

  const activeModel = models.find((m) => m.id === activeModelId);
  const totalMemGB = systemMemory ? (systemMemory.total_bytes / 1_000_000_000).toFixed(0) : '?';
  const hasDownloadedModels = models.some((m) => m.downloaded);

  // RAM-based recommendations
  const ramTier = systemMemory ? getRamTier(systemMemory.total_bytes) : null;
  const defaultModelId = ramTier ? getDefaultModelId(ramTier) : null;

  const sortModels = (list: LocalModelInfo[]) => {
    return [...list].sort((a, b) => {
      switch (sortBy) {
        case 'name': return a.name.localeCompare(b.name);
        case 'size': return a.size_bytes - b.size_bytes;
        case 'ram': return a.ram_required_bytes - b.ram_required_bytes;
      }
    });
  };

  const recommendedModels = useMemo(() => {
    if (!ramTier) return [];
    return sortModels(
      models.filter((m) => m.recommended_for?.includes(ramTier))
    );
  }, [models, ramTier, sortBy]);

  const filteredModels = useMemo(() => {
    let filtered: LocalModelInfo[];
    if (categoryFilter === 'downloaded') {
      filtered = models.filter((m) => m.downloaded);
    } else if (categoryFilter === 'all') {
      filtered = models;
    } else {
      filtered = models.filter((m) => m.category === categoryFilter);
    }
    return sortModels(filtered);
  }, [models, categoryFilter, sortBy]);

  // Batch-fetch metadata for all models when settings panel mounts
  const modelIds = useMemo(() => models.map((m) => ({ id: m.id })), [models]);
  const { metadataMap } = useModelMetadata(modelIds, 'llm');

  const handleSetActive = async (modelId: string) => {
    setActiveModel(modelId);
  };

  const handleHealthCheck = async () => {
    setHealthChecking(true);
    try {
      const status = await tauriApi.getLocalServerStatus();
      if (status.running) {
        toast.success('Local AI server is healthy');
      } else {
        toast.error('Local AI server is not responding');
      }
    } catch (err) {
      toast.error(`Health check failed: ${err}`);
    } finally {
      setHealthChecking(false);
    }
  };

  // Derive a human-readable status message
  const statusMessage = (() => {
    if (serverStatus === 'running' && activeModel) {
      return `Running — ${activeModel.name}`;
    }
    if (serverStatus === 'starting') return 'Loading model...';
    if (serverStatus === 'error') {
      if (binaryStatus === 'not_found') return 'AI engine not found — try reinstalling Notesage';
      if (serverError) {
        if (serverError.includes('healthy within')) return 'Server took too long to start — try a smaller model or restart';
        if (serverError.includes('not found')) return 'Model file missing — download a model below';
        return serverError;
      }
      return 'Server error';
    }
    if (!hasConnection) return 'Not connected — add Local AI in the Connections tab';
    if (!hasDownloadedModels) return 'No models downloaded';
    if (!activeModelId) return 'No model selected';
    return 'Stopped';
  })();

  // Can the server be manually started?
  const canStart = binaryStatus === 'available' && hasDownloadedModels && activeModelId && hasConnection;
  const startDisabledReason = !hasConnection
    ? 'Add Local AI connection first'
    : binaryStatus !== 'available'
    ? 'AI engine not found'
    : !activeModelId
    ? 'Select a model first'
    : !hasDownloadedModels
    ? 'Download a model first'
    : undefined;

  const handleStartOrRestart = async () => {
    if (!activeModelId) return;
    const store = useLocalAIStore.getState();
    if (store.serverStatus === 'running') {
      await tauriApi.stopLocalServer().catch(() => {});
    }
    await startServer(activeModelId, store.contextLength, store.gpuLayers);
  };

  const renderModelCard = (model: LocalModelInfo) => (
    <ModelCard
      key={model.id}
      model={model}
      isActive={model.id === activeModelId}
      isRecommendedDefault={model.id === defaultModelId}
      download={downloads[model.id]}
      metadata={metadataMap[model.id]}
      onSetActive={() => handleSetActive(model.id)}
      onDownload={() => downloadModel(model.id)}
      onCancelDownload={() => cancelDownload(model.id)}
      onDelete={() => deleteModel(model.id)}
      onRemoveCustom={() => removeCustomModel(model.id)}
    />
  );

  return (
    <div className="space-y-6">
      {/* Header + description */}
      <div>
        <div>
          <h3 className="text-sm font-semibold">Local AI</h3>
          <p className="text-xs text-muted-foreground mt-1">
            On-device inference — your data stays private
          </p>
        </div>
        <div className="mt-3 p-3 rounded-md border border-border bg-muted/30">
          <div className="flex items-start gap-2">
            <Shield className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" strokeWidth={1.5} />
            <p className="text-xs text-muted-foreground leading-relaxed">
              Local AI runs language models entirely on your Mac using the bundled llama.cpp engine with Metal GPU acceleration.
              No API keys, no internet connection, and no data ever leaves your device. Download a model below, then add
              Local AI as a connection in the Connections tab to start using it.
            </p>
          </div>
        </div>
      </div>

      {/* Status indicator */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs min-w-0">
          <span
            className={`h-2 w-2 rounded-full shrink-0 ${
              serverStatus === 'running'
                ? 'bg-green-500'
                : serverStatus === 'starting'
                ? 'bg-amber-500 animate-pulse'
                : serverStatus === 'error'
                ? 'bg-red-500'
                : !hasConnection
                ? 'bg-muted-foreground/30'
                : hasDownloadedModels && activeModelId
                ? 'bg-amber-500'
                : 'bg-muted-foreground/30'
            }`}
          />
          <span className={`${serverStatus === 'error' ? 'text-red-500' : 'text-muted-foreground'} truncate`}>
            {statusMessage}
          </span>
          {systemMemory && activeModel && serverStatus === 'running' && (
            <span className="text-muted-foreground/60 shrink-0">
              · ~{formatBytes(activeModel.ram_required_bytes)} / {totalMemGB} GB RAM
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {(serverStatus === 'stopped' || serverStatus === 'error') && hasConnection && (
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs gap-1.5"
                      onClick={handleStartOrRestart}
                      disabled={!canStart}
                    >
                      Start
                    </Button>
                  </span>
                </TooltipTrigger>
                {startDisabledReason && (
                  <TooltipContent side="bottom">
                    <p className="text-xs">{startDisabledReason}</p>
                  </TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>
          )}
          {serverStatus === 'starting' && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1.5"
              disabled
            >
              <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.5} />
              Starting...
            </Button>
          )}
          {serverStatus === 'running' && (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1.5"
                onClick={handleStartOrRestart}
              >
                Restart
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1.5"
                onClick={handleHealthCheck}
                disabled={healthChecking}
              >
                {healthChecking ? (
                  <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.5} />
                ) : (
                  <HeartPulse className="h-3 w-3" strokeWidth={1.5} />
                )}
                Health check
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Binary not found banner */}
      {binaryStatus === 'not_found' && (
        <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3">
          <p className="text-sm font-medium">AI engine not found</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            The llama.cpp inference engine should be bundled with Notesage. Try reinstalling the app.
          </p>
        </div>
      )}

      {/* Models */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Models
          </h4>
          <AddCustomModelDialog onAdded={refreshModels} />
        </div>

        {/* Category filter tabs + sort */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            {CATEGORY_TABS.map((tab) => (
              <button
                key={tab.value}
                onClick={() => setCategoryFilter(tab.value)}
                className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                  categoryFilter === tab.value
                    ? 'bg-primary text-primary-foreground font-medium'
                    : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-1 px-2 py-1 text-[11px] text-muted-foreground rounded-md hover:bg-muted transition-colors">
                <ArrowUpDown className="h-3 w-3" strokeWidth={1.5} />
                {SORT_OPTIONS.find((o) => o.value === sortBy)?.label}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[100px]">
              {SORT_OPTIONS.map((opt) => (
                <DropdownMenuItem
                  key={opt.value}
                  onClick={() => setSortBy(opt.value)}
                  className="text-xs gap-2"
                >
                  {opt.label}
                  {sortBy === opt.value && <Check className="h-3 w-3 ml-auto" strokeWidth={1.5} />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Recommended models section */}
        {recommendedModels.length > 0 && categoryFilter === 'all' && sortBy === 'ram' && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Recommended for your Mac ({totalMemGB} GB):
            </p>
            <TooltipProvider delayDuration={300}>
              {recommendedModels.map(renderModelCard)}
            </TooltipProvider>
          </div>
        )}

        {/* All models */}
        <div className="space-y-2">
          {categoryFilter === 'all' && sortBy === 'ram' && recommendedModels.length > 0 && (
            <p className="text-xs text-muted-foreground pt-2">All models:</p>
          )}
          <TooltipProvider delayDuration={300}>
            {filteredModels.map(renderModelCard)}
          </TooltipProvider>
        </div>

        <div className="flex items-center gap-1.5">
          <p className="text-[10px] text-muted-foreground">
            Models stored in ~/.notesage/models/llm/
          </p>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 text-muted-foreground"
            onClick={async () => {
              try {
                const home = await tauriApi.getHomeDir();
                await tauriApi.revealInFinder(`${home}/.notesage/models/llm`);
              } catch {
                toast.error('Could not open models folder');
              }
            }}
          >
            <FolderOpen className="h-3 w-3" />
          </Button>
        </div>
      </div>

    </div>
  );
}
