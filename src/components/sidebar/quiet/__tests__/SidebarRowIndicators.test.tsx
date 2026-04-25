// @vitest-environment jsdom

import "@/test/tauri-mock";
import { describe, it, expect, beforeEach } from "vitest";
import { renderWithProviders, screen } from "@/test/component-harness";
import { SidebarRowIndicators } from "../SidebarRowIndicators";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useGitStore } from "@/stores/git-store";
import { useEditorStore } from "@/stores/editor-store";
import { useExternalChangeStore } from "@/stores/external-change-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useProjectMetadataStore } from "@/stores/project-metadata-store";
import type { ProjectMetadata } from "@/stores/project-metadata-store";
import type { ExternalChangeEntry } from "@/stores/external-change-store";

/**
 * #129 composition tests for `SidebarRowIndicators`. Each test seeds the
 * relevant stores (git-store, external-change-store, editor-store,
 * project-metadata-store) and asserts the observable indicator markup.
 */

function resetStores() {
  useWorkspaceStore.setState({
    explorerFolders: [],
    projects: [],
    recentProjects: [],
    notesTree: [],
    pinnedFiles: [],
    expandedFolders: new Set<string>(),
    explorerCollapsed: false,
    projectsCollapsed: false,
    notesCollapsed: false,
  });
  useGitStore.setState({ repos: {} });
  useEditorStore.setState({
    openDocuments: [],
    activeTabId: null,
    externalChanges: {},
  } as unknown as Parameters<typeof useEditorStore.setState>[0]);
  useExternalChangeStore.setState({ changes: {} } as unknown as Parameters<typeof useExternalChangeStore.setState>[0]);
  useSettingsStore.setState({ gitEnabled: true } as unknown as Parameters<typeof useSettingsStore.setState>[0]);
  useProjectMetadataStore.setState({ metadataMap: {} } as unknown as Parameters<typeof useProjectMetadataStore.setState>[0]);
}

describe("SidebarRowIndicators (#129)", () => {
  beforeEach(() => {
    resetStores();
  });

  it("renders nothing when the row has no state to surface", () => {
    const { container } = renderWithProviders(
      <SidebarRowIndicators path="/p/a/file.md" kind="file" />,
    );
    expect(container.querySelector("[data-sidebar-indicators]")).toBeNull();
  });

  it("renders the git status glyph + tooltip for a modified file", () => {
    // Seed workspace with the owning project so the hook can resolve the
    // repo root. Then seed the git-store with a modified status.
    useWorkspaceStore.setState((prev) => ({
      ...prev,
      projects: [{ path: "/p", name: "p", fileTree: [] }],
    }));
    useGitStore.setState({
      repos: {
        "/p": {
          isGitRepo: true,
          currentBranch: "main",
          fileStatuses: [{ path: "/p/a/file.md", status: "modified", staged: false }],
          fileStatusMap: new Map([
            ["/p/a/file.md", [{ path: "/p/a/file.md", status: "modified", staged: false }]],
          ]),
          isLoading: false,
          statusError: false,
        },
      },
    });

    renderWithProviders(
      <SidebarRowIndicators path="/p/a/file.md" kind="file" />,
    );

    // The M glyph lands with an aria-label that embeds the tooltip. The
    // hook normalizes "Modified" as the tooltip string.
    expect(screen.getByLabelText(/Git: Modified/i)).toBeTruthy();
  });

  it("renders the aggregate '●' for a folder with git changes inside it", () => {
    useWorkspaceStore.setState((prev) => ({
      ...prev,
      projects: [{ path: "/p", name: "p", fileTree: [] }],
    }));
    useGitStore.setState({
      repos: {
        "/p": {
          isGitRepo: true,
          currentBranch: "main",
          fileStatuses: [{ path: "/p/sub/file.md", status: "modified", staged: false }],
          fileStatusMap: new Map([
            ["/p/sub/file.md", [{ path: "/p/sub/file.md", status: "modified", staged: false }]],
          ]),
          isLoading: false,
          statusError: false,
        },
      },
    });

    renderWithProviders(<SidebarRowIndicators path="/p/sub" kind="folder" />);

    expect(screen.getByLabelText(/Git: Contains changes/i)).toBeTruthy();
  });

  it("renders the external-change dot when the file has a pending external change", () => {
    const entry: ExternalChangeEntry = {
      filePath: "/p/a/file.md",
      fileName: "file.md",
      oldContent: "original",
      newContent: "updated",
      hunks: [],
      timestamp: Date.now(),
      status: "pending",
    };
    useExternalChangeStore.setState({
      changes: { "/p/a/file.md": entry },
    } as unknown as Parameters<typeof useExternalChangeStore.setState>[0]);

    renderWithProviders(
      <SidebarRowIndicators path="/p/a/file.md" kind="file" />,
    );

    expect(
      screen.getByLabelText("External change pending review"),
    ).toBeTruthy();
  });

  it("renders the AI-lock padlock on a project row carrying aiLock metadata", () => {
    const lockedMeta: ProjectMetadata = {
      name: "Locked Project",
      description: "",
      ai: {},
      aiLock: {
        connectionId: "conn-anthropic",
        lockedAt: Date.now(),
      },
    } as ProjectMetadata;
    useProjectMetadataStore.setState({
      metadataMap: { "/p": lockedMeta },
    } as unknown as Parameters<typeof useProjectMetadataStore.setState>[0]);

    renderWithProviders(<SidebarRowIndicators path="/p" kind="project" />);

    expect(
      screen.getByLabelText("Project locked to an AI provider"),
    ).toBeTruthy();
  });

  it("suppresses the AI-lock padlock on file + folder rows even when metadata is set", () => {
    const lockedMeta: ProjectMetadata = {
      name: "Locked Project",
      description: "",
      ai: {},
      aiLock: {
        connectionId: "conn-anthropic",
        lockedAt: Date.now(),
      },
    } as ProjectMetadata;
    useProjectMetadataStore.setState({
      metadataMap: { "/p/a/file.md": lockedMeta },
    } as unknown as Parameters<typeof useProjectMetadataStore.setState>[0]);

    renderWithProviders(
      <SidebarRowIndicators path="/p/a/file.md" kind="file" />,
    );

    // File kind ignores aiLock entirely — no padlock regardless of
    // metadata on the path (which is unrealistic for files anyway).
    expect(
      screen.queryByLabelText("Project locked to an AI provider"),
    ).toBeNull();
  });
});
