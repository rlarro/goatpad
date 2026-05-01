import { contextBridge, ipcRenderer } from 'electron';

type FileResult = { path: string; content: string } | null;
type FolderResult = { path: string; files: { name: string; path: string; mtimeMs: number }[] } | null;
type RecentState = { recentFiles: string[]; recentFolders: string[]; lastFolder: string | null };

const api = {
  openFile: (): Promise<FileResult> => ipcRenderer.invoke('dialog:open-file'),
  openFolder: (): Promise<FolderResult> => ipcRenderer.invoke('dialog:open-folder'),
  saveAs: (): Promise<string | null> => ipcRenderer.invoke('dialog:save-as'),
  listFolder: (path: string) => ipcRenderer.invoke('folder:list', path),
  readFile: (path: string): Promise<string> => ipcRenderer.invoke('file:read', path),
  writeFile: (path: string, content: string) => ipcRenderer.invoke('file:write', path, content),
  writeNextVersion: (path: string, content: string) =>
    ipcRenderer.invoke('file:write-next-version', path, content),
  snapshot: (path: string, content: string) => ipcRenderer.invoke('file:snapshot', path, content),
  getRecent: (): Promise<RecentState> => ipcRenderer.invoke('recent:get'),
  selftestRoundtrip: (path: string) => ipcRenderer.invoke('selftest:roundtrip', path),

  onMenu: (channel: string, handler: (...args: unknown[]) => void) => {
    const wrapped = (_e: Electron.IpcRendererEvent, ...args: unknown[]) => handler(...args);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
};

contextBridge.exposeInMainWorld('api', api);

export type GoatpadApi = typeof api;
