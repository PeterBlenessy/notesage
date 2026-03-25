import { Command, File, FolderDot, Folder, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

interface RecentProject {
  path: string;
  name: string;
}

interface RecentFile {
  path: string;
  name: string;
}

interface EditorEmptyStateProps {
  recentProjects: RecentProject[];
  recentFiles: RecentFile[];
  onNewNote?: () => void;
  onNewProject?: () => void;
  onOpenFolder?: () => void;
  onOpenProject?: (path: string) => void;
  onOpenFile?: (path: string, name: string) => void;
}

export function EditorEmptyState({ recentProjects, recentFiles, onNewNote, onNewProject, onOpenFolder, onOpenProject, onOpenFile }: EditorEmptyStateProps) {
  return (
    <div className="h-full overflow-y-auto @container bg-background">
      <div className="flex min-h-full items-center justify-center">
      <div className="text-center max-w-3xl px-6 py-8">
        <div className="space-y-3 mb-12">
          <img src="/app-icon.svg" alt="Notesage" className="h-14 w-14 mx-auto rounded-xl mb-2" />
          <h2 className="text-xl font-semibold text-foreground">Notesage</h2>
          <p className="text-sm text-muted-foreground max-w-lg mx-auto leading-relaxed">
            Write in a rich markdown editor that feels native to your Mac. Organize your work into projects,
            each with its own structure and settings. When you need a creative partner, bring in AI to improve
            your writing, brainstorm ideas, or summarize long documents — right from the editor.
          </p>
          <p className="text-xs text-muted-foreground/70 max-w-md mx-auto">
            Your files stay on your computer. Pick up where you left off anytime.
          </p>
        </div>
        <div className="grid grid-cols-1 @[768px]:grid-cols-3 gap-3">
          <Card className="text-left flex flex-col">
            <CardHeader className="pb-3 flex-1">
              <CardTitle className="text-base font-semibold inline-flex items-center gap-2">
                <File className="h-5 w-5 text-foreground" strokeWidth={1.5} />
                New Note
              </CardTitle>
              <CardDescription className="text-xs">Quickly jot down an idea or start drafting something new in your notes folder</CardDescription>
            </CardHeader>
            <CardFooter className="pt-0">
              <Button variant="outline" size="sm" className="w-full justify-between text-xs" onClick={() => onNewNote?.()}>
                <span>New Note</span>
                <span className="inline-flex items-center gap-0.5 shrink-0 ml-2">
                  <kbd className="inline-flex items-center justify-center h-[22px] min-w-[22px] px-1 rounded-sm border border-border bg-muted text-xs font-semibold text-foreground/50">
                    <Command className="h-3 w-3" />
                  </kbd>
                  <kbd className="inline-flex items-center justify-center h-[22px] min-w-[22px] px-1 rounded-sm border border-border bg-muted text-xs font-semibold text-foreground/50">
                    N
                  </kbd>
                </span>
              </Button>
            </CardFooter>
          </Card>
          <Card className="text-left flex flex-col">
            <CardHeader className="pb-3 flex-1">
              <CardTitle className="text-base font-semibold inline-flex items-center gap-2">
                <FolderDot className="h-5 w-5 text-foreground" strokeWidth={1.5} />
                New Project
              </CardTitle>
              <CardDescription className="text-xs">Organize your work into a dedicated project with its own folder, settings, and AI context</CardDescription>
            </CardHeader>
            <CardFooter className="pt-0">
              <Button variant="outline" size="sm" className="w-full justify-between text-xs" onClick={() => onNewProject?.()}>
                <span>New Project</span>
                <span className="inline-flex items-center gap-0.5 shrink-0 ml-2">
                  <kbd className="inline-flex items-center justify-center h-[22px] min-w-[22px] px-1 rounded-sm border border-border bg-muted text-xs font-semibold text-foreground/50">
                    <Command className="h-3 w-3" />
                  </kbd>
                  <kbd className="inline-flex items-center justify-center h-[22px] min-w-[22px] px-1 rounded-sm border border-border bg-muted text-sm font-semibold text-foreground/50 leading-none">
                    ⇧
                  </kbd>
                  <kbd className="inline-flex items-center justify-center h-[22px] min-w-[22px] px-1 rounded-sm border border-border bg-muted text-xs font-semibold text-foreground/50">
                    N
                  </kbd>
                </span>
              </Button>
            </CardFooter>
          </Card>
          <Card className="text-left flex flex-col">
            <CardHeader className="pb-3 flex-1">
              <CardTitle className="text-base font-semibold inline-flex items-center gap-2">
                <Folder className="h-5 w-5 text-foreground" strokeWidth={1.5} />
                Open Folder
              </CardTitle>
              <CardDescription className="text-xs">Browse and edit markdown files in any folder on your computer using the Explorer</CardDescription>
            </CardHeader>
            <CardFooter className="pt-0">
              <Button variant="outline" size="sm" className="w-full justify-between text-xs" onClick={() => onOpenFolder?.()}>
                <span>Open Folder</span>
                <span className="inline-flex items-center gap-0.5 shrink-0 ml-2">
                  <kbd className="inline-flex items-center justify-center h-[22px] min-w-[22px] px-1 rounded-sm border border-border bg-muted text-xs font-semibold text-foreground/50">
                    <Command className="h-3 w-3" />
                  </kbd>
                  <kbd className="inline-flex items-center justify-center h-[22px] min-w-[22px] px-1 rounded-sm border border-border bg-muted text-xs font-semibold text-foreground/50">
                    O
                  </kbd>
                </span>
              </Button>
            </CardFooter>
          </Card>
        </div>

        {/* Recent sections */}
        {(recentProjects.length > 0 || recentFiles.length > 0) && (
          <div className="space-y-4 text-left mt-6">
            {recentProjects.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <Clock className="h-3 w-3" />
                  Recent Projects
                </h3>
                <div className="flex flex-wrap gap-2">
                  {recentProjects.map((project) => (
                    <Button
                      key={project.path}
                      variant="outline"
                      size="sm"
                      className="text-xs gap-1.5"
                      onClick={() => onOpenProject?.(project.path)}
                    >
                      <FolderDot className="h-3 w-3 text-muted-foreground" strokeWidth={1.5} />
                      {project.name}
                    </Button>
                  ))}
                </div>
              </div>
            )}
            {recentFiles.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <Clock className="h-3 w-3" />
                  Recent Notes
                </h3>
                <div className="flex flex-wrap gap-2">
                  {recentFiles.map((file) => (
                    <Button
                      key={file.path}
                      variant="outline"
                      size="sm"
                      className="text-xs gap-1.5"
                      onClick={() => onOpenFile?.(file.path, file.name)}
                    >
                      <File className="h-3 w-3 text-muted-foreground" strokeWidth={1.5} />
                      {file.name}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        {/* Privacy note */}
        <div className="pt-24">
          <p className="text-xs text-muted-foreground/50 max-w-md mx-auto leading-relaxed">
            Your files never leave your computer. Notesage reads and writes directly to your local filesystem — no cloud sync, no accounts, no tracking. AI features connect only when you provide an API key.
          </p>
        </div>
      </div>
      </div>
    </div>
  );
}
