/** BATCH-09 candidate only: no updater import, feed, download, or installer. */
export async function checkForUpdate(): Promise<null> { return null; }
export async function downloadUpdate(_version: string): Promise<{ ok: boolean; error: string }> {
  return { ok: false, error: 'Updates are disabled in the local test candidate' };
}
export function cancelUpdateDownload(_version: string): { ok: boolean } { return { ok: true }; }
export function installUpdate(_version: string): { ok: boolean; error: string } {
  return { ok: false, error: 'Updates are disabled in the local test candidate' };
}
