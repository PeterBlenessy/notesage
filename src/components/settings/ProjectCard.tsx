import * as React from 'react';
import {
  Check,
  Cloud,
  Folder,
  GitBranch,
  Lock,
  Pencil,
  Unlock,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { tauriApi } from '@/lib/tauri';
import { migrateProjectPath } from '@/lib/migrate-project-path';
import { useProjectMetadataStore } from '@/stores/project-metadata-store';
import { useSyncStore } from '@/stores/sync-store';
import { useGitStore } from '@/stores/git-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useConnectionsStore } from '@/stores/connections-store';
import { LockProjectDialog } from './LockProjectDialog';

interface ProjectCardProps {
  projectPath: string;
  /** Fired when a rename moves the project folder so callers can re-anchor. */
  onPathChanged?: (newPath: string) => void;
}

function basename(path: string): string {
  return path.split('/').filter(Boolean).pop() || path;
}

/**
 * Minimalistic action pill matching the legacy chat-footer style — a
 * compact `h-7` button with subtle hover ring, optional leading icon,
 * and compact text label. Opens a popover, fires an action, or shows
 * state.
 */
function ActionPill({
  icon: Icon,
  label,
  onClick,
  active = false,
  disabled = false,
  title,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'inline-flex items-center gap-1.5 h-7 px-2 rounded-md text-xs font-medium',
        'transition-colors duration-150 border',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        active
          ? 'border-transparent bg-foreground/10 text-foreground hover:bg-foreground/15'
          : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted hover:border-border',
      )}
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={1.6} />
      {label}
    </button>
  );
}

export function ProjectCard({ projectPath, onPathChanged }: ProjectCardProps) {
  const metadata = useProjectMetadataStore((s) => s.getMetadata(projectPath));
  const updateMetadata = useProjectMetadataStore((s) => s.updateMetadata);
  const isSynced = useSyncStore((s) =>
    s.syncedProjectPaths.includes(projectPath),
  );
  const isGitRepo = useGitStore(
    (s) => s.repos[projectPath]?.isGitRepo ?? false,
  );
  const setIsGitRepo = useGitStore((s) => s.setIsGitRepo);
  const lockedConnection = useConnectionsStore((s) =>
    metadata?.aiLock?.connectionId
      ? s.getConnection(metadata.aiLock.connectionId)
      : undefined,
  );
  const clearAiLock = useProjectMetadataStore((s) => s.clearAiLock);
  const { icloudAvailable, icloudNotesagePath, notesRootPath } =
    useSettingsStore();
  const { addSyncedProject, removeSyncedProject, saveSettings } = useSyncStore();

  // Inline edit state — view mode shows text, edit mode swaps in an
  // input with save/cancel affordances.
  const [nameEditing, setNameEditing] = React.useState(false);
  const [descEditing, setDescEditing] = React.useState(false);
  const [nameDraft, setNameDraft] = React.useState(metadata?.name ?? '');
  const [descDraft, setDescDraft] = React.useState(metadata?.description ?? '');
  const nameInputRef = React.useRef<HTMLInputElement>(null);
  const descInputRef = React.useRef<HTMLTextAreaElement>(null);
  // True while a mousedown is on a cancel icon — onBlur uses this to skip
  // the save it would otherwise fire when focus leaves the input.
  const cancellingRef = React.useRef(false);

  // Re-sync drafts when metadata changes externally (e.g., rename completes).
  React.useEffect(() => {
    if (!nameEditing) setNameDraft(metadata?.name ?? '');
  }, [metadata?.name, nameEditing]);
  React.useEffect(() => {
    if (!descEditing) setDescDraft(metadata?.description ?? '');
  }, [metadata?.description, descEditing]);

  // Auto-focus + select-all when entering edit mode.
  React.useEffect(() => {
    if (nameEditing) {
      const el = nameInputRef.current;
      if (el) {
        el.focus();
        el.select();
      }
    }
  }, [nameEditing]);
  React.useEffect(() => {
    if (descEditing) {
      const el = descInputRef.current;
      if (el) {
        el.focus();
        el.select();
      }
    }
  }, [descEditing]);

  const [renaming, setRenaming] = React.useState(false);
  const [icloudConfirmOpen, setIcloudConfirmOpen] = React.useState<
    'enable' | 'disable' | null
  >(null);
  const [gitConfirmOpen, setGitConfirmOpen] = React.useState(false);
  const [lockDialogOpen, setLockDialogOpen] = React.useState(false);
  const [unlockConfirmOpen, setUnlockConfirmOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const isLocked = !!metadata?.aiLock;

  /** Save the name draft. Returns true on success (caller exits edit
   * mode), false on failure (caller stays in edit mode so the user can
   * fix the conflict / try again). */
  const commitName = React.useCallback(async (): Promise<boolean> => {
    if (!metadata || renaming) return false;
    const trimmed = nameDraft.trim();
    if (!trimmed) {
      // Empty name — revert silently.
      setNameDraft(metadata.name);
      return true;
    }
    if (trimmed === metadata.name) return true;

    const currentFolderName = basename(projectPath);
    if (trimmed === currentFolderName) {
      updateMetadata(projectPath, { name: trimmed });
      return true;
    }

    const parentDir = projectPath.substring(0, projectPath.lastIndexOf('/'));
    const newPath = `${parentDir}/${trimmed}`;

    try {
      const exists = await tauriApi.pathExists(newPath);
      if (exists) {
        toast.error(`A folder named "${trimmed}" already exists`);
        return false;
      }
    } catch {
      // Fall through — best-effort rename.
    }

    setRenaming(true);
    try {
      await tauriApi.renamePath(projectPath, newPath);
      await migrateProjectPath(projectPath, newPath);
      onPathChanged?.(newPath);
      toast.success(`Project renamed to "${trimmed}"`);
      return true;
    } catch (err) {
      toast.error(`Failed to rename folder: ${err}`);
      return false;
    } finally {
      setRenaming(false);
    }
  }, [metadata, nameDraft, projectPath, renaming, updateMetadata, onPathChanged]);

  const commitDescription = React.useCallback((): boolean => {
    if (!metadata) return false;
    const trimmed = descDraft.trim();
    if (trimmed === metadata.description) return true;
    updateMetadata(projectPath, { description: trimmed });
    return true;
  }, [metadata, descDraft, projectPath, updateMetadata]);

  const handleNameSave = async () => {
    const ok = await commitName();
    if (ok) setNameEditing(false);
  };
  const handleNameCancel = () => {
    setNameDraft(metadata?.name ?? '');
    setNameEditing(false);
  };
  const handleDescSave = () => {
    const ok = commitDescription();
    if (ok) setDescEditing(false);
  };
  const handleDescCancel = () => {
    setDescDraft(metadata?.description ?? '');
    setDescEditing(false);
  };

  const handleIcloudPillClick = () => {
    if (!icloudAvailable) {
      toast.error('iCloud Drive is not available on this device');
      return;
    }
    setIcloudConfirmOpen(isSynced ? 'disable' : 'enable');
  };

  const handleIcloudConfirm = async () => {
    if (!icloudConfirmOpen) return;
    const enable = icloudConfirmOpen === 'enable';
    setIcloudConfirmOpen(null);
    setBusy(true);
    try {
      if (enable && icloudNotesagePath) {
        const alreadyInICloud = projectPath.startsWith(
          icloudNotesagePath + '/',
        );
        if (alreadyInICloud) {
          addSyncedProject(projectPath);
          await saveSettings(notesRootPath);
          toast.success('Project marked as synced to iCloud');
        } else {
          const newPath = await tauriApi.migrateToICloud(
            projectPath,
            icloudNotesagePath,
          );
          await migrateProjectPath(projectPath, newPath);
          addSyncedProject(newPath);
          await saveSettings(notesRootPath);
          onPathChanged?.(newPath);
          toast.success('Project synced to iCloud');
        }
      } else if (!enable && notesRootPath) {
        const newPath = await tauriApi.migrateFromICloud(
          projectPath,
          notesRootPath,
        );
        await migrateProjectPath(projectPath, newPath);
        removeSyncedProject(projectPath);
        await saveSettings(notesRootPath);
        onPathChanged?.(newPath);
        toast.success('Project moved to local library');
      }
    } catch (err) {
      toast.error(`Failed to ${enable ? 'sync' : 'unsync'}: ${err}`);
    } finally {
      setBusy(false);
    }
  };

  const handleGitPillClick = () => {
    if (isGitRepo) {
      // Settings card doesn't expose a destructive "remove repo" action;
      // it would delete `.git/`. Users can do that from the terminal.
      toast.info('Git is initialized. Manage commits from the sidebar.');
      return;
    }
    setGitConfirmOpen(true);
  };

  const handleGitConfirm = async () => {
    setGitConfirmOpen(false);
    setBusy(true);
    try {
      await tauriApi.gitInit(projectPath);
      setIsGitRepo(projectPath, true);
      toast.success('Git repository initialized');
    } catch (err) {
      toast.error(`Failed to initialize git: ${err}`);
    } finally {
      setBusy(false);
    }
  };

  const handleLockPillClick = () => {
    if (isLocked) {
      setUnlockConfirmOpen(true);
    } else {
      setLockDialogOpen(true);
    }
  };

  const handleUnlockConfirm = () => {
    clearAiLock(projectPath);
    setUnlockConfirmOpen(false);
    toast.success('Project unlocked');
  };

  if (!metadata) {
    return null;
  }

  return (
    <div
      data-slot="project-card"
      className="rounded-lg border border-border bg-background px-3 py-2 transition-colors duration-150"
    >
      <div className="flex items-start gap-3">
        <Folder
          className={cn(
            'h-5 w-5 mt-0.5 shrink-0',
            isLocked
              ? 'text-[var(--color-accent-primary)]'
              : 'text-muted-foreground',
          )}
          strokeWidth={1.5}
        />

        <div className="flex-1 min-w-0 space-y-1">
          {/* ── Name ────────────────────────────────────────────────
              View mode: text + pen icon on hover. Double-click text or
              click pen → edit mode (input + save / cancel icons).
              Enter saves, Esc cancels, blur saves (unless cancel was
              just clicked — `cancellingRef` flag intercepts the blur
              that would otherwise overwrite the cancel revert). */}
          <div className="group/name flex items-center gap-1 h-7">
            {nameEditing ? (
              <>
                <Input
                  ref={nameInputRef}
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onBlur={async () => {
                    if (cancellingRef.current) {
                      cancellingRef.current = false;
                      return;
                    }
                    const ok = await commitName();
                    if (ok) setNameEditing(false);
                  }}
                  onKeyDown={async (e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      await handleNameSave();
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      handleNameCancel();
                    }
                  }}
                  disabled={renaming || busy}
                  placeholder="Project name"
                  className={cn(
                    'h-7 py-0 px-2 text-[14px] font-medium',
                    'bg-transparent border border-border',
                    'focus-visible:ring-0 focus-visible:border-foreground/50',
                    'rounded-md',
                  )}
                />
                <button
                  type="button"
                  onClick={handleNameSave}
                  disabled={renaming}
                  title="Save"
                  className="h-7 w-7 shrink-0 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors duration-150 disabled:opacity-50"
                >
                  <Check className="h-3.5 w-3.5" strokeWidth={1.6} />
                </button>
                <button
                  type="button"
                  onMouseDown={() => {
                    cancellingRef.current = true;
                  }}
                  onClick={handleNameCancel}
                  title="Cancel"
                  className="h-7 w-7 shrink-0 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors duration-150"
                >
                  <X className="h-3.5 w-3.5" strokeWidth={1.6} />
                </button>
              </>
            ) : (
              <>
                <span
                  className="text-[14px] font-medium text-foreground truncate cursor-text leading-tight"
                  onDoubleClick={() => setNameEditing(true)}
                  title="Double-click to rename"
                >
                  {metadata.name || basename(projectPath)}
                </span>
                <button
                  type="button"
                  onClick={() => setNameEditing(true)}
                  title="Rename project"
                  className={cn(
                    'h-7 w-7 shrink-0 inline-flex items-center justify-center rounded-md',
                    'text-muted-foreground hover:text-foreground hover:bg-muted',
                    'transition-opacity duration-150 opacity-0 group-hover/name:opacity-100',
                    'focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                  )}
                >
                  <Pencil className="h-3.5 w-3.5" strokeWidth={1.6} />
                </button>
              </>
            )}
          </div>

          {/* ── Description ─────────────────────────────────────────
              Same pattern as name. Multi-line; Enter inserts a newline
              (Cmd/Ctrl+Enter saves), Esc cancels, blur saves. The
              edit-mode buttons sit on the same baseline as the first
              row of the textarea so the icon column lines up with the
              pen icon in view mode. */}
          <div className="group/desc flex items-start gap-1">
            {descEditing ? (
              <>
                <Textarea
                  ref={descInputRef}
                  value={descDraft}
                  onChange={(e) => setDescDraft(e.target.value)}
                  onBlur={() => {
                    if (cancellingRef.current) {
                      cancellingRef.current = false;
                      return;
                    }
                    const ok = commitDescription();
                    if (ok) setDescEditing(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      handleDescSave();
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      handleDescCancel();
                    }
                  }}
                  disabled={busy}
                  placeholder="No description"
                  rows={2}
                  className={cn(
                    'min-h-[3rem] py-1 px-2 text-[12px] text-muted-foreground',
                    'bg-transparent border border-border resize-none',
                    'focus-visible:ring-0 focus-visible:border-foreground/50',
                    'rounded-md',
                  )}
                />
                <button
                  type="button"
                  onClick={handleDescSave}
                  title="Save (⌘+Enter)"
                  className="h-7 w-7 shrink-0 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors duration-150"
                >
                  <Check className="h-3.5 w-3.5" strokeWidth={1.6} />
                </button>
                <button
                  type="button"
                  onMouseDown={() => {
                    cancellingRef.current = true;
                  }}
                  onClick={handleDescCancel}
                  title="Cancel (Esc)"
                  className="h-7 w-7 shrink-0 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors duration-150"
                >
                  <X className="h-3.5 w-3.5" strokeWidth={1.6} />
                </button>
              </>
            ) : (
              <>
                <span
                  className={cn(
                    'text-[12px] flex-1 cursor-text whitespace-pre-wrap leading-tight',
                    metadata.description
                      ? 'text-muted-foreground'
                      : 'text-muted-foreground/60 italic',
                  )}
                  onDoubleClick={() => setDescEditing(true)}
                  title="Double-click to edit description"
                >
                  {metadata.description || 'No description'}
                </span>
                <button
                  type="button"
                  onClick={() => setDescEditing(true)}
                  title="Edit description"
                  className={cn(
                    'h-7 w-7 shrink-0 inline-flex items-center justify-center rounded-md',
                    'text-muted-foreground hover:text-foreground hover:bg-muted',
                    'transition-opacity duration-150 opacity-0 group-hover/desc:opacity-100',
                    'focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                  )}
                >
                  <Pencil className="h-3.5 w-3.5" strokeWidth={1.6} />
                </button>
              </>
            )}
          </div>

          {/* Action row — three minimalistic pills matching the chat
              footer style (h-7, transparent border, subtle hover). */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <ActionPill
              icon={Cloud}
              label={isSynced ? 'iCloud · on' : 'iCloud · off'}
              active={isSynced}
              onClick={handleIcloudPillClick}
              disabled={busy || !icloudAvailable}
              title={
                !icloudAvailable
                  ? 'iCloud Drive not available on this device'
                  : isSynced
                    ? 'Move project back to local library'
                    : 'Mirror project to iCloud Drive'
              }
            />
            <ActionPill
              icon={GitBranch}
              label={isGitRepo ? 'Git · on' : 'Git · off'}
              active={isGitRepo}
              onClick={handleGitPillClick}
              disabled={busy}
              title={
                isGitRepo
                  ? 'Git initialized — manage from the sidebar'
                  : 'Initialize a git repository in this project'
              }
            />
            <ActionPill
              icon={isLocked ? Lock : Unlock}
              label={
                isLocked
                  ? `Locked${
                      lockedConnection ? ` · ${lockedConnection.label}` : ''
                    }`
                  : 'Lock provider'
              }
              active={isLocked}
              onClick={handleLockPillClick}
              disabled={busy}
              title={
                isLocked
                  ? `Locked to ${lockedConnection?.label ?? metadata.aiLock?.connectionId}. Click to unlock.`
                  : 'Lock chat to a single AI provider in this project'
              }
            />
          </div>
        </div>
      </div>

      {/* iCloud confirm */}
      <AlertDialog
        open={icloudConfirmOpen !== null}
        onOpenChange={(open) => !open && setIcloudConfirmOpen(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {icloudConfirmOpen === 'enable'
                ? 'Sync project to iCloud?'
                : 'Move project back to local?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {icloudConfirmOpen === 'enable'
                ? 'This will move the project folder to iCloud Drive. Other Macs signed into the same Apple ID will see this project once iCloud finishes syncing.'
                : 'This will move the project folder back to your local Notesage library. iCloud will stop syncing it on other devices.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleIcloudConfirm}>
              {icloudConfirmOpen === 'enable' ? 'Move to iCloud' : 'Move to local'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Git init confirm */}
      <AlertDialog open={gitConfirmOpen} onOpenChange={setGitConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Initialize git repository?</AlertDialogTitle>
            <AlertDialogDescription>
              Runs <code className="font-mono">git init</code> in the project
              folder. You can then commit, branch, and push from the sidebar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleGitConfirm}>
              Initialize
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Unlock confirm */}
      <AlertDialog
        open={unlockConfirmOpen}
        onOpenChange={setUnlockConfirmOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unlock AI provider?</AlertDialogTitle>
            <AlertDialogDescription>
              Chat in this project will be free to use any provider again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleUnlockConfirm}>
              Unlock
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Lock dialog (existing) */}
      <LockProjectDialog
        open={lockDialogOpen}
        onOpenChange={setLockDialogOpen}
        projectPath={projectPath}
        projectName={metadata.name || basename(projectPath)}
      />
    </div>
  );
}
