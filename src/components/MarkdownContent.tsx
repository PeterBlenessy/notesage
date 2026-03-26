import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { openUrl } from '@tauri-apps/plugin-opener';
import { cn } from '@/lib/utils';
import { tauriApi } from '@/lib/tauri';
import { useEditorStore } from '@/stores/editor-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { setBinaryData } from '@/lib/binary-cache';
import { parseFrontmatter } from '@/lib/frontmatter';
import { getFileType, isBinaryFileType } from '@/lib/file-utils';
import { toast } from 'sonner';

/** File extensions that can be opened as editor tabs. */
const OPENABLE_EXTENSIONS = /\.(md|txt|json|yaml|yml|toml|csv|html|htm|css|js|ts|jsx|tsx|rs|py|rb|go|java|c|cpp|h|sh|sql|xml|svg|epub|pdf|docx)$/i;

function isUrl(href: string): boolean {
  return /^https?:\/\//.test(href) || href.startsWith('mailto:');
}

interface MarkdownContentProps {
  content: string;
  className?: string;
}

export function MarkdownContent({ content, className }: MarkdownContentProps) {
  const openTab = useEditorStore((s) => s.openTab);
  const projects = useWorkspaceStore((s) => s.projects);
  const explorerFolders = useWorkspaceStore((s) => s.explorerFolders);

  /** Try to open a file path as an editor tab. Returns true on success. */
  const tryOpenFile = async (filePath: string): Promise<boolean> => {
    const fileName = filePath.split('/').pop() || filePath;
    const fileType = getFileType(fileName);
    try {
      if (isBinaryFileType(fileType)) {
        const bytes = await tauriApi.readBinaryFile(filePath);
        setBinaryData(filePath, new Uint8Array(bytes));
        openTab(filePath, fileName, '', null, fileType);
      } else {
        const raw = await tauriApi.readFile(filePath);
        if (fileType === 'markdown') {
          const { frontmatter, content: body } = parseFrontmatter(raw);
          openTab(filePath, fileName, body, frontmatter, fileType);
        } else {
          openTab(filePath, fileName, raw, null, fileType);
        }
      }
      return true;
    } catch {
      return false;
    }
  };

  /** Resolve a relative path against all workspace directories. */
  const resolveRelativePath = async (relativePath: string): Promise<boolean> => {
    const roots = [
      ...projects.map((p) => p.path),
      ...explorerFolders.map((f) => f.path),
    ];
    for (const root of roots) {
      const candidate = `${root}/${relativePath}`;
      if (await tryOpenFile(candidate)) return true;
    }
    return false;
  };

  const handleLinkClick = async (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    e.preventDefault();

    // External URLs — open in system browser
    if (isUrl(href)) {
      openUrl(href).catch(() => window.open(href, '_blank'));
      return;
    }

    // Only try to open as file if it has a recognized extension
    if (!OPENABLE_EXTENSIONS.test(href)) {
      openUrl(href).catch(() => {
        toast.error(`Could not open link: ${href}`);
      });
      return;
    }

    // Absolute path — try directly
    if (href.startsWith('/') || href.startsWith('~')) {
      if (await tryOpenFile(href)) return;
      toast.error(`File not found: ${href}`);
      return;
    }

    // Relative path — resolve against workspace roots
    if (await resolveRelativePath(href)) return;

    // Nothing worked
    toast.error(`Could not resolve link: ${href}`);
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
