import { useCallback, useState, useEffect, useMemo } from 'react';
import { Search, FolderOpen, FolderKanban, StickyNote, ListChecks, MessageSquare, Bot, Target, Layers, Square, CheckSquare2, List } from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useActionStore, type ActionSourceType } from '@/stores/action-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useSettingsStore } from '@/stores/settings-store';

export function ActionFilterBar({ children }: { children?: React.ReactNode }) {
  const filter = useActionStore((s) => s.filter);
  const setFilter = useActionStore((s) => s.setFilter);
  const projects = useWorkspaceStore((s) => s.projects);
  const explorerFolders = useWorkspaceStore((s) => s.explorerFolders);
  const notesRootPath = useSettingsStore((s) => s.notesRootPath);

  const actions = useActionStore((s) => s.actions);

  // Build deduplicated list of all filterable roots with open counts
  const allRoots = useMemo(() => {
    const seen = new Set<string>();
    const roots: { path: string; label: string; count: number; kind: 'project' | 'folder' | 'notes' }[] = [];
    for (const p of projects) {
      if (!seen.has(p.path)) {
        seen.add(p.path);
        roots.push({ path: p.path, label: p.path.split('/').pop() ?? p.path, count: 0, kind: 'project' });
      }
    }
    for (const f of explorerFolders) {
      if (!seen.has(f.path)) {
        seen.add(f.path);
        roots.push({ path: f.path, label: f.path.split('/').pop() ?? f.path, count: 0, kind: 'folder' });
      }
    }
    if (notesRootPath && !seen.has(notesRootPath)) {
      roots.push({ path: notesRootPath, label: 'Quick Notes', count: 0, kind: 'notes' });
    }
    // Count open actions per root
    for (const a of actions) {
      if (a.status === 'done' || a.status === 'completed') continue;
      const root = roots.find((r) => a.project_root === r.path);
      if (root) root.count++;
    }
    return roots;
  }, [projects, explorerFolders, notesRootPath, actions]);

  const [searchInput, setSearchInput] = useState(filter.search);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilter({ search: searchInput });
    }, 150);
    return () => clearTimeout(timer);
  }, [searchInput, setFilter]);

  const handleSourceType = useCallback((value: string) => {
    if (value === 'all') {
      setFilter({ sourceType: ['task', 'comment', 'agent', 'goal'] });
    } else {
      setFilter({ sourceType: [value as ActionSourceType] });
    }
  }, [setFilter]);

  const handleStatus = useCallback((value: string) => {
    if (value === 'all') {
      setFilter({ status: ['open', 'done', 'delegated', 'pending', 'running', 'completed', 'error'] });
    } else if (value === 'open') {
      setFilter({ status: ['open', 'delegated', 'pending', 'running'] });
    } else if (value === 'done') {
      setFilter({ status: ['done', 'completed'] });
    } else {
      console.warn('[ActionFilterBar] Unhandled status value:', value);
    }
  }, [setFilter]);

  const handleProject = useCallback((value: string) => {
    setFilter({ project: value === 'all' ? null : value });
  }, [setFilter]);

  // Count actions per source type
  const typeCounts = useMemo(() => {
    let task = 0, comment = 0, agent = 0, goal = 0;
    for (const a of actions) {
      if (a.source_type === 'task') task++;
      else if (a.source_type === 'comment') comment++;
      else if (a.source_type === 'agent') agent++;
      else if (a.source_type === 'goal') goal++;
    }
    return { task, comment, agent, goal, all: task + comment + agent + goal };
  }, [actions]);

  // Count actions per status (delegated counted as open — they're in-progress agent tasks)
  const statusCounts = useMemo(() => {
    let open = 0, done = 0;
    for (const a of actions) {
      if (a.status === 'open' || a.status === 'delegated' || a.status === 'pending' || a.status === 'running') open++;
      else if (a.status === 'done' || a.status === 'completed') done++;
    }
    return { open, done, all: open + done };
  }, [actions]);

  // Derive current select values from filter state
  const sourceValue = filter.sourceType.length >= 4 ? 'all'
    : filter.sourceType.length === 1 ? filter.sourceType[0]
    : 'all';

  const statusValue = filter.status.length >= 7 ? 'all'
    : filter.status.includes('open') && !filter.status.includes('done') ? 'open'
    : filter.status.includes('done') && !filter.status.includes('open') ? 'done'
    : 'all';

  return (
    <div className="space-y-2">
      {/* Search — full width on top */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.5} />
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search actions..."
          className="h-8 text-xs pl-8"
        />
      </div>

      {/* Filter dropdowns */}
      <div className="flex items-center gap-2">
        <Select value={sourceValue} onValueChange={handleSourceType}>
          <SelectTrigger className="h-7 text-xs w-auto min-w-[110px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              <span className="flex items-center gap-1.5">
                <Layers className="h-3 w-3 text-muted-foreground shrink-0" strokeWidth={1.5} />
                <span>All types</span>
                <span className="text-muted-foreground/60">{typeCounts.all}</span>
              </span>
            </SelectItem>
            <SelectItem value="task">
              <span className="flex items-center gap-1.5">
                <ListChecks className="h-3 w-3 text-muted-foreground shrink-0" strokeWidth={1.5} />
                <span>Tasks</span>
                <span className="text-muted-foreground/60">{typeCounts.task}</span>
              </span>
            </SelectItem>
            <SelectItem value="comment">
              <span className="flex items-center gap-1.5">
                <MessageSquare className="h-3 w-3 text-muted-foreground shrink-0" strokeWidth={1.5} />
                <span>Comments</span>
                <span className="text-muted-foreground/60">{typeCounts.comment}</span>
              </span>
            </SelectItem>
            <SelectItem value="agent">
              <span className="flex items-center gap-1.5">
                <Bot className="h-3 w-3 text-muted-foreground shrink-0" strokeWidth={1.5} />
                <span>Agent tasks</span>
                <span className="text-muted-foreground/60">{typeCounts.agent}</span>
              </span>
            </SelectItem>
            <SelectItem value="goal">
              <span className="flex items-center gap-1.5">
                <Target className="h-3 w-3 text-muted-foreground shrink-0" strokeWidth={1.5} />
                <span>Goals</span>
                <span className="text-muted-foreground/60">{typeCounts.goal}</span>
              </span>
            </SelectItem>
          </SelectContent>
        </Select>

        <Select value={statusValue} onValueChange={handleStatus}>
          <SelectTrigger className="h-7 text-xs w-auto min-w-[80px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="open">
              <span className="flex items-center gap-1.5">
                <Square className="h-3 w-3 text-muted-foreground shrink-0" strokeWidth={1.5} />
                <span>Open</span>
                <span className="text-muted-foreground/60">{statusCounts.open}</span>
              </span>
            </SelectItem>
            <SelectItem value="done">
              <span className="flex items-center gap-1.5">
                <CheckSquare2 className="h-3 w-3 text-muted-foreground shrink-0" strokeWidth={1.5} />
                <span>Done</span>
                <span className="text-muted-foreground/60">{statusCounts.done}</span>
              </span>
            </SelectItem>
            <SelectItem value="all">
              <span className="flex items-center gap-1.5">
                <List className="h-3 w-3 text-muted-foreground shrink-0" strokeWidth={1.5} />
                <span>All</span>
                <span className="text-muted-foreground/60">{statusCounts.all}</span>
              </span>
            </SelectItem>
          </SelectContent>
        </Select>

        {allRoots.length > 1 && (
          <Select value={filter.project ?? 'all'} onValueChange={handleProject}>
            <SelectTrigger className="h-7 text-xs w-auto min-w-[110px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All actions</SelectItem>
              {(() => {
                const projectRoots = allRoots.filter((r) => r.kind === 'project');
                const folderRoots = allRoots.filter((r) => r.kind === 'folder');
                const notesRoots = allRoots.filter((r) => r.kind === 'notes');
                return (
                  <>
                    {projectRoots.length > 0 && (
                      <SelectGroup>
                        <SelectLabel>Projects</SelectLabel>
                        {projectRoots.map((r) => (
                          <SelectItem key={r.path} value={r.path}>
                            <span className="flex items-center gap-1.5">
                              <FolderKanban className="h-3 w-3 text-muted-foreground shrink-0" strokeWidth={1.5} />
                              <span>{r.label}</span>
                              <span className="text-muted-foreground/60">{r.count}</span>
                            </span>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    )}
                    {folderRoots.length > 0 && (
                      <SelectGroup>
                        <SelectLabel>Folders</SelectLabel>
                        {folderRoots.map((r) => (
                          <SelectItem key={r.path} value={r.path}>
                            <span className="flex items-center gap-1.5">
                              <FolderOpen className="h-3 w-3 text-muted-foreground shrink-0" strokeWidth={1.5} />
                              <span>{r.label}</span>
                              <span className="text-muted-foreground/60">{r.count}</span>
                            </span>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    )}
                    {notesRoots.length > 0 && (
                      <SelectGroup>
                        <SelectLabel>Notes</SelectLabel>
                        {notesRoots.map((r) => (
                          <SelectItem key={r.path} value={r.path}>
                            <span className="flex items-center gap-1.5">
                              <StickyNote className="h-3 w-3 text-muted-foreground shrink-0" strokeWidth={1.5} />
                              <span>{r.label}</span>
                              <span className="text-muted-foreground/60">{r.count}</span>
                            </span>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    )}
                  </>
                );
              })()}
            </SelectContent>
          </Select>
        )}
        {children && <div className="ml-auto">{children}</div>}
      </div>
    </div>
  );
}
