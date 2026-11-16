import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { transformSources, ID, NAME } from './candidate.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const helper = join(root, '.github/shotloom-electron-test');
const policy = JSON.parse(readFileSync(join(helper, 'policy.json'), 'utf8'));
const targets = { main: 'electron/main.ts', paths: 'electron/core/paths.ts', updater: 'electron/core/updater.ts', packaging: 'scripts/electron-package.mjs' };
const source = {};
for (const [key, file] of Object.entries(targets)) {
  source[key] = readFileSync(join(root, file), 'utf8');
  const hash = createHash('sha256').update(source[key].replaceAll('\r\n', '\n')).digest('hex');
  if (hash !== policy.sourceSha256[file]) throw new Error('Unreviewed source drift: ' + file);
}
const transformed = transformSources(source, readFileSync(join(helper, 'updater-disabled.ts'), 'utf8'));
const require = createRequire(join(root, 'package.json'));
const config = require('yaml').parse(readFileSync(join(root, 'electron-builder.yml'), 'utf8'));
config.appId = ID;
config.productName = NAME;
config.executableName = 'shotloom-local-test';
config.extraMetadata = { ...(config.extraMetadata || {}), name: 'shotloom-local-test', productName: NAME };
config.directories = { ...config.directories, output: 'release/batch09' };
config.publish = null;
config.npmRebuild = false;
config.forceCodeSigning = false;
config.win = { ...config.win, signAndEditExecutable: false };
mkdirSync(join(root, 'tmp/batch09'), { recursive: true });
writeFileSync(join(root, 'tmp/batch09/electron-builder.json'), JSON.stringify(config, null, 2));
for (const [key, file] of Object.entries(targets)) writeFileSync(join(root, file), transformed[key]);
if (existsSync(join(root, 'electron/candidate-isolation.ts'))) throw new Error('Candidate bootstrap already exists');
copyFileSync(join(helper, 'isolation-bootstrap.ts'), join(root, 'electron/candidate-isolation.ts'));
console.log('Applied disposable candidate-only identity/bootstrap/updater/builder transforms; tracked contribution branch untouched');
