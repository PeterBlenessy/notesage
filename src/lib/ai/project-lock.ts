import type { ProjectMetadata } from '@/stores/project-metadata-store';

export class ProjectLockViolation extends Error {
  readonly projectPath: string;
  readonly lockedConnectionId: string;
  readonly attemptedConnectionId: string | null;

  constructor(projectPath: string, lockedConnectionId: string, attemptedConnectionId: string | null) {
    super(
      `Project "${projectPath}" is locked to connection ${lockedConnectionId}; attempted send with ${attemptedConnectionId ?? '(no connection)'}.`,
    );
    this.name = 'ProjectLockViolation';
    this.projectPath = projectPath;
    this.lockedConnectionId = lockedConnectionId;
    this.attemptedConnectionId = attemptedConnectionId;
  }
}

export interface LockConflict {
  projectPath: string;
  lockedConnectionId: string;
}

export function getProjectLock(
  projectPath: string,
  metadataMap: Record<string, ProjectMetadata>,
): { connectionId: string } | null {
  const lock = metadataMap[projectPath]?.aiLock;
  return lock ? { connectionId: lock.connectionId } : null;
}

export function findLockConflict(
  selectedProjectPaths: readonly string[],
  metadataMap: Record<string, ProjectMetadata>,
  currentConnectionId: string | null,
): LockConflict | null {
  for (const path of selectedProjectPaths) {
    const lock = getProjectLock(path, metadataMap);
    if (!lock) continue;
    if (lock.connectionId !== currentConnectionId) {
      return { projectPath: path, lockedConnectionId: lock.connectionId };
    }
  }
  return null;
}

export function getUniqueLockedConnectionIds(
  selectedProjectPaths: readonly string[],
  metadataMap: Record<string, ProjectMetadata>,
): string[] {
  const ids = new Set<string>();
  for (const path of selectedProjectPaths) {
    const lock = getProjectLock(path, metadataMap);
    if (lock) ids.add(lock.connectionId);
  }
  return Array.from(ids);
}

export function hasLockedProject(
  selectedProjectPaths: readonly string[],
  metadataMap: Record<string, ProjectMetadata>,
): boolean {
  return getUniqueLockedConnectionIds(selectedProjectPaths, metadataMap).length > 0;
}

export function describeLockTarget(
  connectionId: string,
  connectionLabel?: string | null,
): string {
  return connectionLabel && connectionLabel.trim().length > 0 ? connectionLabel : connectionId;
}
