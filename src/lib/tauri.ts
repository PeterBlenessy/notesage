import { invoke } from "@tauri-apps/api/core";

export interface FileEntry {
  name: string;
  path: string;
  is_directory: boolean;
  children?: FileEntry[];
}

export const tauriApi = {
  async readFile(path: string): Promise<string> {
    return await invoke<string>("read_file", { path });
  },

  async writeFile(path: string, content: string): Promise<void> {
    await invoke("write_file", { path, content });
  },

  async listDirectory(path: string): Promise<FileEntry[]> {
    return await invoke<FileEntry[]>("list_directory", { path });
  },

  async createFile(path: string): Promise<void> {
    await invoke("create_file", { path });
  },

  async createDirectory(path: string): Promise<void> {
    await invoke("create_directory", { path });
  },

  async renamePath(oldPath: string, newPath: string): Promise<void> {
    await invoke("rename_path", { oldPath, newPath });
  },

  async deletePath(path: string): Promise<void> {
    await invoke("delete_path", { path });
  },

  async pathExists(path: string): Promise<boolean> {
    return await invoke<boolean>("path_exists", { path });
  },

  async openFolderDialog(): Promise<string | null> {
    return await invoke<string | null>("open_folder_dialog");
  },

  async getHomeDir(): Promise<string> {
    return await invoke<string>("get_home_dir");
  },
};
