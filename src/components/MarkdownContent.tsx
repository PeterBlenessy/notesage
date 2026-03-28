import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';
import { useEditorStore } from '@/stores/editor-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { handleLinkNavigation } from '@/lib/link-utils';

interface MarkdownContentProps {
  content: string;
  className?: string;
}

export function MarkdownContent({ content, className }: MarkdownContentProps) {
  const openTab = useEditorStore((s) => s.openTab);
  const projects = useWorkspaceStore((s) => s.projects);
  const explorerFolders = useWorkspaceStore((s) => s.explorerFolders);

  const handleLinkClick = async (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    e.preventDefault();
    const roots = [
      ...projects.map((p) => p.path),
      ...explorerFolders.map((f) => f.path),
    ];
    await handleLinkNavigation(href, openTab, roots);
  };

  return (
    <div
      className={cn(
        'chat-markdown leading-relaxed overflow-hidden [&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
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
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
