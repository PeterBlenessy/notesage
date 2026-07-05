import { memo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';
import { useEditorStore } from '@/stores/editor-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { handleLinkNavigation } from '@/lib/link-utils';

interface MarkdownContentProps {
  content: string;
  className?: string;
}

// Resolve workspace roots + openTab at click time via getState() rather than
// subscribing. Link clicks are rare, and subscribing forced every rendered chat
// message to re-render — and ReactMarkdown to re-parse its whole body — whenever
// the project or explorer-folder lists changed. Reading on demand keeps this
// component's render a pure function of its props.
async function handleLinkClick(e: React.MouseEvent<HTMLAnchorElement>, href: string) {
  e.preventDefault();
  const { projects, explorerFolders } = useWorkspaceStore.getState();
  const { openTab } = useEditorStore.getState();
  const roots = [
    ...projects.map((p) => p.path),
    ...explorerFolders.map((f) => f.path),
  ];
  await handleLinkNavigation(href, openTab, roots);
}

// Hoisted to module scope: both the plugin array and the components map were
// previously allocated per render, defeating ReactMarkdown's own memoization
// and churning garbage in the chat list. The `a` handler reads stores via
// getState() at click time (see handleLinkClick above), so it closes over
// nothing render-scoped — safe to share a single instance across all renders.
const REMARK_PLUGINS = [remarkGfm];

const MARKDOWN_COMPONENTS: Components = {
  a: ({ href, children, ...props }) => (
    <a
      {...props}
      href={href}
      onClick={(e) => href && handleLinkClick(e, href)}
      className="underline decoration-muted-foreground/40 underline-offset-2 hover:decoration-foreground transition-colors cursor-pointer"
    >
      {children}
    </a>
  ),
};

function MarkdownContentImpl({ content, className }: MarkdownContentProps) {
  return (
    <div
      className={cn(
        'chat-markdown leading-relaxed overflow-hidden [&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={MARKDOWN_COMPONENTS}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

// Memoized on (content, className): markdown parsing via ReactMarkdown is the
// hot cost in the chat list. Without this, every chat-store change (e.g. the
// isLoading toggle at the start/end of a send, or a single message streaming)
// re-rendered ALL rendered messages and re-parsed each one's full markdown.
// Now an instance only re-parses when its own `content` actually changes — the
// streaming message updates, the rest stay cached (audit perf B1).
export const MarkdownContent = memo(MarkdownContentImpl);
