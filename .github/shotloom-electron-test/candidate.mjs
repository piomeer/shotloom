import { isAbsolute, join, resolve, relative, sep } from 'node:path';
export const ID = 'com.shotloom.localtest.batch09';
export const NAME = 'Shotloom Local Test';
export function inside(root, target) {
  const rel = relative(resolve(root), resolve(target));
  return rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel);
}
export function planPaths(base, runId) {
  if (!isAbsolute(base)) throw new Error('Candidate base must be absolute');
  if (!/^batch09-[a-z0-9-]{8,80}$/i.test(runId)) throw new Error('Unsafe run id');
  const root = join(base, 'data', runId);
  return { root, appData: join(root, 'application'), projects: join(root, 'application', 'projects'),
    userData: join(root, 'webview'), sessionData: join(root, 'session'), profile: join(root, 'profile'),
    temp: join(root, 'temp'), logs: join(root, 'logs'), crashDumps: join(root, 'crash-dumps'),
    downloads: join(root, 'downloads'), documents: join(root, 'documents') };
}
export function requireApproval(policy, context) {
  if (context.repository !== 'piomeer/shotloom' || context.ref !== 'refs/heads/test/windows-electron-candidate' || context.event !== 'push') throw new Error('Wrong cloud scope');
  if (policy.validationExecutionApproved !== true) throw new Error('Cloud validation not authorized');
  executionModes(policy);
  return true;
}
export const VALIDATION_STAGES = ['root-deps', 'focused', 'typecheck', 'related', 'architecture'];
export const BUILD_STAGES = ['native-root', 'host-deps', 'director-deps', 'openreel', 'prepare', 'candidate-typecheck', 'package', 'resources'];
export function executionModes(policy) {
  const validation = policy.validationExecutionApproved === true;
  const build = policy.fullBuildApproved === true;
  if (build && !validation) throw new Error('Full build requires validation approval');
  if (build && (policy.dependencyScriptsReviewed !== true || policy.candidatePackagingApproved !== true)) throw new Error('Full build requires reviewed scripts and packaging approval');
  return { validation, build };
}
export function assertStageAllowed(policy, stage) {
  if (!VALIDATION_STAGES.includes(stage) && !BUILD_STAGES.includes(stage)) throw new Error('Unknown stage');
  const modes = executionModes(policy);
  if (!modes.validation) throw new Error('Cloud validation not authorized');
  if (BUILD_STAGES.includes(stage) && !modes.build) throw new Error('Full build not authorized');
  return true;
}
export function assertValidationResults(results, commit) {
  if (!commit) throw new Error('Missing validation commit');
  for (const stage of ['focused', 'typecheck', 'related', 'architecture']) {
    const result = results.find(item => item.stage === stage);
    if (!result || !result.pass || result.exitCode !== 0 || result.node !== 'v22.19.0' || result.commit !== commit) throw new Error('Missing, failed or stale Node22 validation: ' + stage);
  }
  return true;
}
export function checkSpace({ free, used, reserve, additional, cap }) {
  if (![free, used, reserve, additional, cap].every(n => Number.isFinite(n) && n >= 0)) throw new Error('Invalid space measurement');
  if (free < reserve + additional || used > cap) throw new Error('BLOCKED: disk budget or reserve');
  return true;
}
export function parseTestSummary(text) {
  const out = {};
  for (const name of ['tests', 'pass', 'fail', 'skipped']) {
    const all = [...text.matchAll(new RegExp('(?:#|ℹ)\\s+' + name + '\\s+(\\d+)', 'g'))];
    if (!all.length) return null;
    out[name] = Number(all.at(-1)[1]);
  }
  return out;
}
function replaceOnce(text, before, after) {
  if (text.split(before).length !== 2) throw new Error('Changed or duplicate source anchor: ' + before);
  return text.replace(before, after);
}
export function transformSources(source, disabledUpdater) {
  return {
    main: "import './candidate-isolation';\n" + replaceOnce(source.main, "app.setName('Shotloom');", "app.setName('Shotloom Local Test');"),
    paths: replaceOnce(source.paths, "export const APP_IDENTIFIER = 'com.shotloom.app';", "export const APP_IDENTIFIER = '" + ID + "';"),
    updater: disabledUpdater,
    packaging: replaceOnce(replaceOnce(source.packaging,
      'export async function packageElectron({ dirOnly = CLI_ONLY_DIR() } = {}) {',
      "export async function packageElectron({ dirOnly = CLI_ONLY_DIR() } = {}) {\n  if (!dirOnly) throw new Error('Candidate supports directory only');"),
      "const artifacts = await electronBuild({ projectDir: rootDir, publish: 'never', ...signing, ...(dirOnly ? { dir: true } : {}) });",
      "const artifacts = await electronBuild({ projectDir: rootDir, config: rootDir + '/tmp/batch09/electron-builder.json', publish: 'never', dir: true });"),
  };
}
export function requiredResources() {
  return ['shotloom-local-test.exe', 'chrome_100_percent.pak', 'chrome_200_percent.pak', 'icudtl.dat',
    'resources.pak', 'v8_context_snapshot.bin', 'locales/en-US.pak', 'ffmpeg.dll',
    'resources/app.asar', 'resources/ffmpeg.exe', 'resources/resources/FFmpeg-GPL-3.0.txt',
    'resources/resources/FFmpeg-SOURCE.txt', 'resources/resources/provider-plugins/index.json',
    'resources/resources/agent-host/node.exe', 'resources/resources/agent-host/dist/main.js',
    'resources/resources/agent-host/client-dist/index.html', 'resources/resources/agent-host/package.json',
    'resources/resources/agent-host/runtime.json', 'resources/resources/agent-host/AGENTS.md'];
}
