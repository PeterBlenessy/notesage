import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useLocalAIStore } from '@/stores/local-ai-store';
import { useSettingsStore } from '@/stores/settings-store';
import { tauriApi } from '@/lib/tauri';
import type {
  HfModelSearchResult,
  HfModelFile,
  HfModelDetails,
  ModelFitInput,
  ModelFitResult,
  GgufCapabilities,
} from '@/lib/tauri';
import {
  toModelFitInput,
  parseParamsB,
  fitSummary,
  compareByVerdict,
} from '@/lib/ai/model-fit';
import { Button } from '@/components/ui/button';
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
import { Download, X, Plus, Link, Loader2, Search } from 'lucide-react';
import { toast } from 'sonner';

function formatBytes(bytes: number): string {
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(0)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
}

/** Stable per-file id used to key transient fit/caps maps. */
function fileId(repoId: string, filename: string): string {
  return `${repoId}/${filename}`;
}

/**
 * Derive a billions-of-parameters figure for an HF result. HF search results
 * rarely carry a clean `parameters` string, so we parse a "<n>B" token out of
 * the model name first, then fall back to the repo id (which usually embeds
 * the size, e.g. `bartowski/Qwen2.5-7B-Instruct-GGUF`). Returns null when no
 * size can be recovered — the row then shows "Can't estimate" instead of a
 * (misleading) verdict.
 */
function deriveParamsB(result: HfModelSearchResult): number | null {
  return parseParamsB(result.model_name) ?? parseParamsB(result.repo_id);
}

/**
 * Pick the representative file for a repo-level verdict: prefer a Q4_K_M build
 * (the recommended balance), else the smallest GGUF. The per-file picker shows
 * each file's own verdict; this is only for the collapsed result row.
 */
function representativeFile(files: HfModelFile[]): HfModelFile | null {
  if (files.length === 0) return null;
  const q4 = files.find((f) => /Q4_K_M/i.test(f.quantization) || /Q4_K_M/i.test(f.filename));
  if (q4) return q4;
  return [...files].sort((a, b) => a.size_bytes - b.size_bytes)[0];
}

/** Compact pre-download verdict line + chips for one file, wrapped in a tooltip. */
function VerdictLine({
  fit,
  caps,
}: {
  fit: ModelFitResult | undefined;
  caps: GgufCapabilities | undefined;
}) {
  const verdict = fitSummary(fit);
  const blocked = fit != null && !fit.runnable;
  if (!verdict && !caps) {
    return (
      <div className="text-[10px] tabular-nums text-muted-foreground/50">
        Can't estimate — unknown size
      </div>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-1.5 flex-wrap">
          {verdict ? (
            <span className="text-[10px] tabular-nums text-muted-foreground">{verdict}</span>
          ) : (
            <span className="text-[10px] tabular-nums text-muted-foreground/50">
              Can't estimate — unknown size
            </span>
          )}
          {blocked && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-destructive/10 text-destructive">
              {fit?.reasons[0] ?? "Won't run"}
            </span>
          )}
          {caps?.has_fim_tokens && (
            <span className="text-[9px] font-medium px-1 py-px rounded bg-muted text-muted-foreground">
              FIM
            </span>
          )}
          {caps?.has_tool_template && (
            <span className="text-[9px] font-medium px-1 py-px rounded bg-muted text-muted-foreground">
              Tools
            </span>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-[260px]">
        <p className="text-xs">Estimated before download — sharpens once the model runs.</p>
        {blocked && fit && fit.reasons.length > 0 && (
          <ul className="mt-1 text-[11px] text-muted-foreground list-disc pl-3.5 space-y-0.5">
            {fit.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        )}
        {(caps?.has_fim_tokens || caps?.has_tool_template) && (
          <p className="mt-1 text-[11px] text-muted-foreground">
            FIM / Tools verified from the model header.
          </p>
        )}
      </TooltipContent>
    </Tooltip>
  );
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

  // --- Hardware-aware fit / capability verdicts for HF results -------------
  // HF result ids are transient, so we keep fit/caps in LOCAL state keyed by
  // `${repo_id}/${filename}` rather than polluting the global store.
  const hardwareProfile = useLocalAIStore((s) => s.hardwareProfile);
  const planningCtx = useSettingsStore((s) => s.localPlanningContext);
  const [fitById, setFitById] = useState<Record<string, ModelFitResult>>({});
  const [capsById, setCapsById] = useState<Record<string, GgufCapabilities>>({});
  // Files whose GGUF header we've already requested (avoid refetch storms).
  const capsRequested = useRef<Set<string>>(new Set());

  // Detect the hardware profile once per session (cached in the store).
  useEffect(() => {
    if (hardwareProfile) return;
    let cancelled = false;
    tauriApi
      .detectHardwareProfile()
      .then((p) => {
        if (!cancelled) useLocalAIStore.getState().setHardwareProfile(p);
      })
      .catch((e) => console.warn('[model-fit] hardware detect failed:', e));
    return () => {
      cancelled = true;
    };
  }, [hardwareProfile]);

  // All (result, file) pairs currently visible in the search results.
  const visibleFiles = useMemo(() => {
    const pairs: { id: string; result: HfModelSearchResult; file: HfModelFile }[] = [];
    for (const result of searchResults) {
      const paramsB = deriveParamsB(result);
      for (const file of result.files) {
        pairs.push({ id: fileId(result.repo_id, file.filename), result, file });
        void paramsB;
      }
    }
    return pairs;
  }, [searchResults]);

  // Stable key for the visible-file set (drives the estimate/caps effects).
  const visibleKey = useMemo(
    () => visibleFiles.map((p) => p.id).join(','),
    [visibleFiles],
  );

  // Estimate fit for every visible file (batched in one IPC call).
  useEffect(() => {
    if (!hardwareProfile || visibleFiles.length === 0) return;
    const inputs: ModelFitInput[] = [];
    for (const { id, result, file } of visibleFiles) {
      const paramsB = deriveParamsB(result);
      if (paramsB == null) continue;
      const input = toModelFitInput({
        id,
        size_bytes: file.size_bytes,
        parameters: `${paramsB}B`,
        quantization: file.quantization !== 'Unknown' ? file.quantization : undefined,
        filename: file.filename,
      });
      if (input) inputs.push(input);
    }
    if (inputs.length === 0) return;

    let cancelled = false;
    tauriApi
      .estimateModelFit(inputs, hardwareProfile, planningCtx)
      .then((results) => {
        if (cancelled) return;
        setFitById((prev) => {
          const next = { ...prev };
          for (const r of results) next[r.id] = r;
          return next;
        });
      })
      .catch((e) => console.warn('[model-fit] estimate failed:', e));
    return () => {
      cancelled = true;
    };
  }, [hardwareProfile, planningCtx, visibleKey, visibleFiles]);

  // Read GGUF capabilities per file, best-effort + deduped. The download_url is
  // a resolve URL usable directly for a cheap header read; failures are
  // swallowed (the row just stays "unverified").
  useEffect(() => {
    if (visibleFiles.length === 0) return;
    const toFetch = visibleFiles.filter((p) => !capsRequested.current.has(p.id));
    if (toFetch.length === 0) return;

    let cancelled = false;
    void Promise.all(
      toFetch.map(async ({ id, file }) => {
        capsRequested.current.add(id);
        if (!file.download_url) return;
        try {
          const caps = await tauriApi.readGgufCapabilities(file.download_url, null);
          if (!cancelled) setCapsById((prev) => ({ ...prev, [id]: caps }));
        } catch {
          // Unverified — UI falls back to the catalog flag.
        }
      }),
    );
    return () => {
      cancelled = true;
    };
  }, [visibleKey, visibleFiles]);

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

  // The representative-file fit for a result row (Q4_K_M build, else smallest).
  const resultFit = useCallback(
    (result: HfModelSearchResult): ModelFitResult | undefined => {
      const rep = representativeFile(result.files);
      return rep ? fitById[fileId(result.repo_id, rep.filename)] : undefined;
    },
    [fitById],
  );
  const resultCaps = useCallback(
    (result: HfModelSearchResult): GgufCapabilities | undefined => {
      const rep = representativeFile(result.files);
      return rep ? capsById[fileId(result.repo_id, rep.filename)] : undefined;
    },
    [capsById],
  );

  // Filtered results based on capability filters (applied client-side), then
  // sorted runnable-first via the representative-file verdict. HF relevance
  // order is preserved as the tiebreaker (stable sort over the indexed list).
  const filteredResults = useMemo(() => {
    const base = searchResults.filter((r) => {
      if (filterCaps.size === 0) return true;
      if (filterCaps.has('Vision') && !r.supports_vision) return false;
      if (filterCaps.has('Tools') && !r.supports_tool_calling) return false;
      if (filterCaps.has('Thinking') && !r.supports_thinking) return false;
      return true;
    });
    return base
      .map((r, i) => ({ r, i }))
      .sort((a, b) => {
        const v = compareByVerdict({ fit: resultFit(a.r) }, { fit: resultFit(b.r) });
        return v !== 0 ? v : a.i - b.i;
      })
      .map((x) => x.r);
  }, [searchResults, filterCaps, resultFit]);

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
        <TooltipProvider delayDuration={300}>
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
                      .map((file, i) => ({ file, i }))
                      .sort((a, b) => {
                        const id = (f: HfModelFile) => fileId(selectedRepo.repo_id, f.filename);
                        const v = compareByVerdict(
                          { fit: fitById[id(a.file)] },
                          { fit: fitById[id(b.file)] },
                        );
                        if (v !== 0) return v;
                        return a.file.size_bytes - b.file.size_bytes;
                      })
                      .map(({ file }) => {
                        const id = fileId(selectedRepo.repo_id, file.filename);
                        const fit = fitById[id];
                        const caps = capsById[id];
                        const blocked = fit != null && !fit.runnable;
                        return (
                          <button
                            key={file.filename}
                            onClick={() => handleAddFromSearch(file)}
                            disabled={loading || blocked}
                            title={blocked ? fit?.reasons[0] ?? "Won't run on this Mac" : undefined}
                            className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md border border-border/50 text-left hover:bg-muted transition-colors disabled:cursor-not-allowed ${
                              blocked ? 'opacity-60 hover:bg-transparent' : ''
                            } ${loading ? 'disabled:opacity-50' : ''}`}
                          >
                            <div className="min-w-0 flex-1 space-y-0.5">
                              <div className="text-xs font-medium truncate">
                                {file.quantization !== 'Unknown' ? file.quantization : file.filename.replace('.gguf', '')}
                              </div>
                              <div className="text-[10px] text-muted-foreground truncate">
                                {file.size_bytes > 0 && <>{formatBytes(file.size_bytes)} &middot; ~{formatBytes(Math.round(file.size_bytes * 1.1))} RAM</>}
                                {file.size_bytes > 0 && file.quantization !== 'Unknown' && <> &middot; </>}
                                {file.quantization !== 'Unknown' && <span className="opacity-60">{file.filename}</span>}
                              </div>
                              <VerdictLine fit={fit} caps={caps} />
                            </div>
                            <Download className="h-3.5 w-3.5 text-muted-foreground shrink-0" strokeWidth={1.5} />
                          </button>
                        );
                      })}
                  </div>
                </ScrollArea>
              </div>

            ) : (
              /* Search results list */
              <ScrollArea className="h-[350px]">
                <div className="space-y-1 pr-4">
                  {filteredResults.map((result) => {
                    const fit = resultFit(result);
                    const caps = resultCaps(result);
                    const blocked = fit != null && !fit.runnable;
                    return (
                    <div
                      key={result.repo_id}
                      className={`flex items-start gap-2.5 px-2.5 py-2 rounded-md border border-border/50 hover:bg-muted transition-colors overflow-hidden cursor-pointer ${
                        blocked ? 'opacity-60' : ''
                      }`}
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
                        <div className="mt-1">
                          <VerdictLine fit={fit} caps={caps} />
                        </div>
                      </div>
                    </div>
                    );
                  })}
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
        </TooltipProvider>
      </DialogContent>
    </Dialog>
  );
}
