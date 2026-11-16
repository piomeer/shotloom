/** Imported before all product IPC modules in the candidate build only. */
import { app } from 'electron';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve, parse } from 'node:path';

const id = 'com.shotloom.localtest.batch09';
const root = process.env.SHOTLOOM_CANDIDATE_ROOT || '';
const base = dirname(dirname(process.execPath));
const policyFile = join(base, 'candidate-policy.json');
if (process.platform !== 'win32' || !isAbsolute(root)) throw new Error('Candidate requires isolated Windows launcher');
const policy = JSON.parse(readFileSync(policyFile, 'utf8'));
if (policy.localRunAuthorized !== true || policy.applicationId !== id) throw new Error('Candidate runtime is not authorized');
if (dirname(root).toLowerCase() !== join(base, 'data').toLowerCase() || !/^batch09-[a-z0-9-]{8,80}$/i.test(root.slice(dirname(root).length + 1))) throw new Error('Invalid candidate root');
for (let p = root; p !== parse(p).root; p = dirname(p)) {
  if (existsSync(p) && lstatSync(p).isSymbolicLink()) throw new Error('Candidate paths cannot use links');
}
if (realpathSync(root).toLowerCase() !== resolve(root).toLowerCase()) throw new Error('Candidate root canonicalization failed');
const marker = JSON.parse(readFileSync(join(root, '.batch09-isolation.json'), 'utf8'));
if (marker.applicationId !== id || marker.freshRun !== true) throw new Error('Missing fresh-run marker');
const paths = {
  appData: join(root, 'application'), userData: join(root, 'webview'), sessionData: join(root, 'session'),
  home: join(root, 'profile'), temp: join(root, 'temp'), logs: join(root, 'logs'),
  crashDumps: join(root, 'crash-dumps'), documents: join(root, 'documents'), downloads: join(root, 'downloads'),
};
if (process.env.SHOTLOOM_APPDATA_DIR !== paths.appData || process.env.SHOTLOOM_USER_DATA !== paths.userData) throw new Error('Candidate overrides do not match');
for (const path of Object.values(paths)) mkdirSync(path, { recursive: true });
mkdirSync(join(paths.appData, 'projects'), { recursive: true });
for (const [name, path] of Object.entries(paths)) app.setPath(name, path);
app.setName('Shotloom Local Test');
app.setAppUserModelId(id);
app.setAppLogsPath(paths.logs);
app.commandLine.appendSwitch('disk-cache-dir', join(root, 'chromium-cache'));
process.env.HOME = paths.home;
process.env.USERPROFILE = paths.home;
process.env.APPDATA = join(paths.home, 'AppData', 'Roaming');
process.env.LOCALAPPDATA = join(paths.home, 'AppData', 'Local');
process.env.TEMP = paths.temp;
process.env.TMP = paths.temp;
process.env.SHOTLOOM_WINDOW = JSON.stringify({ title: 'Shotloom Local Test - BATCH-09' });
writeFileSync(join(root, 'isolation-paths.json'), JSON.stringify({ applicationId: id, paths, updates: 'disabled' }, null, 2), { flag: 'wx' });
