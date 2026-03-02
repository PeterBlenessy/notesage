import { FileEntry } from "@/lib/tauri";
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";

interface FolderPickerItemProps {
  folder: FileEntry;
  onMoveTo: (path: string) => void;
  entryPath: string;
  entryIsDirectory: boolean;
  currentParent: string;
}

export function FolderPickerItem({ folder, onMoveTo, entryPath, entryIsDirectory, currentParent }: FolderPickerItemProps) {
  // Filter out the entry itself and its descendants from subfolders
  const subfolders = (folder.children ?? []).filter((e) =>
    e.is_directory && e.name !== ".notesage" && e.name !== ".git" &&
    !(entryIsDirectory && (e.path === entryPath || e.path.startsWith(entryPath + "/")))
  );
  const isCurrentParent = folder.path === currentParent;
  if (subfolders.length === 0) {
    return (
      <ContextMenuItem onClick={() => onMoveTo(folder.path)} disabled={isCurrentParent}>
        {folder.name}{isCurrentParent ? <span className="ml-1 text-muted-foreground text-xs">(current)</span> : null}
      </ContextMenuItem>
    );
  }
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>{folder.name}</ContextMenuSubTrigger>
      <ContextMenuSubContent>
        <ContextMenuItem onClick={() => onMoveTo(folder.path)} disabled={isCurrentParent}>
          <span className="text-muted-foreground">(here){isCurrentParent ? " — current location" : ""}</span>
        </ContextMenuItem>
        <ContextMenuSeparator />
        {subfolders.map((child) => (
          <FolderPickerItem key={child.path} folder={child} onMoveTo={onMoveTo} entryPath={entryPath} entryIsDirectory={entryIsDirectory} currentParent={currentParent} />
        ))}
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}
