export interface NpmListNode {
  version?: string;
  path?: string;
  dependencies?: Record<string, NpmListNode>;
}

export interface NpmPackage {
  name: string;
  version: string;
  path: string | null;
}

export function collectNpmPackages(roots: Array<{ dependencies?: Record<string, NpmListNode> }>): NpmPackage[];
