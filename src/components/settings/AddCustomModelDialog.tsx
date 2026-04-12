import { useState, useMemo, useCallback, useRef } from 'react';
import { useLocalAIStore } from '@/stores/local-ai-store';
import { tauriApi } from '@/lib/tauri';
import type { HfModelSearchResult, HfModelFile, HfModelDetails } from '@/lib/tauri';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Download, X, Plus, Link, Loader2, Search } from 'lucide-react';
import { toast } from 'sonner';

function formatBytes(bytes: number): string {
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(0)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
}

export function AddCustomModelDialog({ onAdded }: { onAdded: () => void }) {
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
        author: r.author || undefined,
        architecture: r.architecture || undefined,
        contextLength: r.context_length || undefined,
        license: r.license || undefined,
        baseModel: r.base_model || undefined,
      });
      // Auto-start download after adding
      const modelId = file.filename.replace('.gguf', '').toLowerCase().replace(/ /g, '-');
      useLocalAIStore.getState().downloadModel(modelId);
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
                    <X className="h-2.5 w-2.5 opacity-40 group-hover:opacity-100 transition-opacity" strokeWidth={2} />
                  </button>
                )}
                {[...filterCaps].map((cap) => (
                  <button
                    key={cap}
                    onClick={() => toggleCapFilter(cap)}
                    className="group flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-muted text-foreground hover:bg-muted/80 transition-colors"
                  >
                    {cap}
                    <X className="h-2.5 w-2.5 opacity-40 group-hover:opacity-100 transition-opacity" strokeWidth={2} />
                  </button>
                ))}
              </div>
            )}

            {selectedRepo ? (
              /* Model detail + file picker */
              <div className="flex flex-col gap-2 min-h-0">
                <button
                  onClick={() => { setSelectedRepo(null); setRepoDetails(null); }}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
                >
                  &larr; Back to results
                </button>

                {/* Model info card — fixed, not scrolled */}
                <div className="rounded-lg border border-border p-3 space-y-1.5 shrink-0">
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

                <p className="text-[10px] text-muted-foreground shrink-0">
                  Pick a size variant. Smaller files run faster but with lower quality. Q4_K_M offers the best balance.
                </p>

                {/* File list — scrollable */}
                <ScrollArea className="h-[220px]">
                  <div className="space-y-1 pr-4">
                    {(repoDetails?.files || selectedRepo.files)
                      .sort((a, b) => a.size_bytes - b.size_bytes)
                      .map((file) => (
                        <button
                          key={file.filename}
                          onClick={() => handleAddFromSearch(file)}
                          disabled={loading}
                          className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md border border-border/50 text-left hover:bg-muted transition-colors disabled:opacity-50"
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
              <ScrollArea className="h-[350px]">
                <div className="space-y-1 pr-4">
                  {filteredResults.map((result) => (
                    <div
                      key={result.repo_id}
                      className="flex items-start gap-2.5 px-2.5 py-2 rounded-md border border-border/50 hover:bg-muted transition-colors overflow-hidden cursor-pointer"
                      onClick={() => handleSelectRepo(result)}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-1.5 truncate">
                          <span className="text-xs font-medium truncate">{result.model_name}</span>
                          {result.author && (
                            <button
                              className="text-[10px] text-muted-foreground hover:text-foreground hover:underline transition-colors shrink-0"
                              onClick={(e) => { e.stopPropagation(); setAuthorFilter(result.author); }}
                            >by {result.author}</button>
                          )}
                        </div>
                        <div className="text-[10px] text-muted-foreground truncate">
                          {result.architecture && <>{result.architecture}</>}
                          {result.context_length && <> &middot; {(result.context_length / 1024).toFixed(0)}K context</>}
                          {result.total_size && <> &middot; ~{formatBytes(result.total_size)}</>}
                          {result.license && <> &middot; {result.license}</>}
                        </div>
                        <div className="text-[10px] text-muted-foreground/60 truncate">
                          {result.files.length} variant{result.files.length !== 1 ? 's' : ''}
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
