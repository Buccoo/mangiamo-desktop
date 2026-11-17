type UpdateResult = { ok: true } | { ok: false; reason?: string; error?: string };

export function createDesktopUpdateActions(options: {
  enabled: () => boolean;
  downloaded: () => boolean;
  canInstall?: () => boolean;
  download: () => Promise<string[]>;
  install: (silent: boolean, forceRunAfter: boolean) => void;
  schedule: (callback: () => void) => void;
  onError: (error: unknown) => void;
}) {
  let transfer: Promise<UpdateResult> | null = null;
  let installing = false;
  let installGeneration = 0;
  return {
    get downloading() { return transfer !== null; },
    get installing() { return installing; },
    resetInstall() { installing = false; installGeneration++; },
    download(): Promise<UpdateResult> {
      if (!options.enabled()) return Promise.resolve({ ok: false, reason: 'UPDATER_DISABLED' });
      if (options.downloaded()) return Promise.resolve({ ok: true });
      if (transfer) return transfer;
      transfer = (async (): Promise<UpdateResult> => {
        try {
          const files = await options.download();
          // electron-updater verifies the checksum before emitting update-downloaded.
          // An empty/fulfilled promise must never manufacture that confirmation.
          if (!files.length || !options.downloaded()) return { ok: false, reason: 'UPDATE_NOT_DOWNLOADED' };
          return { ok: true };
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
      })().finally(() => { transfer = null; });
      return transfer;
    },
    install(): UpdateResult {
      if (!options.enabled()) return { ok: false, reason: 'UPDATER_DISABLED' };
      if (!options.downloaded()) return { ok: false, reason: 'UPDATE_NOT_DOWNLOADED' };
      if (installing) return { ok: true };
      if (options.canInstall && !options.canInstall()) return { ok: false, reason: 'PRINT_JOBS_ACTIVE' };
      installing = true;
      const generation = ++installGeneration;
      // Let IPC deliver its acknowledgement before Electron closes the renderer.
      options.schedule(() => {
        if (generation !== installGeneration) return;
        try {
          if (options.canInstall && !options.canInstall()) throw new Error('PRINT_JOBS_ACTIVE');
          options.install(true, true);
        }
        catch (error) { installing = false; options.onError(error); }
      });
      return { ok: true };
    },
  };
}
