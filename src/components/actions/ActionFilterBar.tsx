import { useCallback, useState, useEffect } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useActionStore, type ActionSourceType, type ActionStatus } from '@/stores/action-store';
import { useWorkspaceStore } from '@/stores/workspace-store';

export function ActionFilterBar({ children }: { children?: React.ReactNode }) {
  const filter = useActionStore((s) => s.filter);
  const setFilter = useActionStore((s) => s.setFilter);
  const projects = useWorkspaceStore((s) => s.projects);

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
    } else {
      setFilter({ status: [value as ActionStatus] });
    }
  }, [setFilter]);

  const handleProject = useCallback((value: string) => {
    setFilter({ project: value === 'all' ? null : value });
  }, [setFilter]);

  // Derive current select values from filter state
  const sourceValue = filter.sourceType.length === 4 ? 'all'
    : filter.sourceType.length === 1 ? filter.sourceType[0]
    : 'all';

  const statusValue = filter.status.length > 3 ? 'all'
    : filter.status.includes('open') && filter.status.length <= 4 ? 'open'
    : filter.status.length === 1 ? filter.status[0]
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
          <SelectTrigger className="h-7 text-xs w-[110px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="task">Tasks</SelectItem>
            <SelectItem value="comment">Comments</SelectItem>
            <SelectItem value="agent">Agent tasks</SelectItem>
            <SelectItem value="goal">Goals</SelectItem>
          </SelectContent>
        </Select>

        <Select value={statusValue} onValueChange={handleStatus}>
          <SelectTrigger className="h-7 text-xs w-[100px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="done">Done</SelectItem>
            <SelectItem value="delegated">Delegated</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>

        {projects.length > 1 && (
          <Select value={filter.project ?? 'all'} onValueChange={handleProject}>
            <SelectTrigger className="h-7 text-xs w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All projects</SelectItem>
              {projects.map((p) => {
                const name = p.path.split('/').pop() ?? p.path;
                return (
                  <SelectItem key={p.path} value={p.path}>
                    {name}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        )}
        {children && <div className="ml-auto">{children}</div>}
      </div>
    </div>
  );
}
