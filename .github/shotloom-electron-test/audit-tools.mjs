import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, lstatSync, readdirSync, statfsSync, statSync, copyFileSync, realpathSync } from 'node:fs';
import { resolve, relative, dirname, join, parse, isAbsolute, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import { executionModes, inside, ID, NAME, checkSpace } from './candidate.mjs';

export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function verifyBytes(bytes, spec) {
  if (spec.bytes !== undefined && bytes.length !== spec.bytes) throw new Error('Asset size mismatch');
  if (spec.sha256 && digest(bytes) !== spec.sha256) throw new Error('Asset digest mismatch');
  if (spec.integrity) {
    const [algorithm, expected] = spec.integrity.split('-', 2);
    if (!['sha512', 'sha256'].includes(algorithm) || createHash(algorithm).update(bytes).digest('base64') !== expected) throw new Error('Asset digest mismatch');
  }
  if (!spec.sha256 && !spec.integrity) throw new Error('Missing asset digest');
  return true;
}
export function assertOwnedPath(root, target) {
  root=resolve(root); target=resolve(target);
  if (!inside(root,target)) throw new Error('Path outside owned cache');
  // Check every existing ancestor, including the workspace itself.
  for(let path=target;;path=dirname(path)) {
    if(existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error('Owned cache cannot use link');
    if(dirname(path)===path) break;
  }
  return target;
}
export function cacheEnvironment(root) {
  const scratch=join(root,'tmp/batch09');
  return { FFMPEG_BIN:join(root,'node_modules/ffmpeg-static/ffmpeg.exe'), LOCALAPPDATA:join(scratch,'profile/local'), APPDATA:join(scratch,'profile/roaming'),
    npm_config_cache:join(scratch,'npm-cache'), npm_config_userconfig:join(scratch,'npmrc'),
    npm_config_store_dir:join(scratch,'pnpm-store'), ELECTRON_CACHE:join(scratch,'electron-cache'),
    electron_config_cache:join(scratch,'electron-cache'), ELECTRON_BUILDER_CACHE:join(scratch,'builder-cache'),
    NODE_COMPILE_CACHE:join(scratch,'node-compile-cache'), TEMP:join(scratch,'temp'), TMP:join(scratch,'temp'),
    SHOTLOOM_PNPM:'"'+join(scratch,'pnpm.cmd')+'"' };
}
export function assertCacheEnvironment(root, env) {
  const expected=cacheEnvironment(root);
  for(const [key,value] of Object.entries(expected)) {
    if(key==='SHOTLOOM_PNPM') { if(env[key]!==value) throw new Error('Unexpected pnpm entry');continue; }
    if(!env[key] || resolve(env[key])!==resolve(value)) throw new Error('Uncontrolled cache environment: '+key);
    assertOwnedPath(root,value);
  }
  return true;
}
const GROUPS={
 rootNodeModules:'node_modules', hostNodeModules:'harness/host/node_modules', directorNodeModules:'vendor/shotloom-director-desk/node_modules',
 pnpmStore:'tmp/batch09/pnpm-store', npmCache:'tmp/batch09/npm-cache',
 electronRuntime:'node_modules/electron/dist', electronCache:'tmp/batch09/electron-cache',
 ffmpegCache:'tmp/batch09/profile/local/ffmpeg-static-nodejs/Cache', ffmpegExecutable:'node_modules/ffmpeg-static/ffmpeg.exe',
 resources:'electron/resources', dist:'dist', candidate:'release/batch09/win-unpacked', tmp:'tmp',
 temporaryLogs:'tmp/batch09', profile:'tmp/batch09/profile', builderCache:'tmp/batch09/builder-cache',
};
export function measureWorkspace(root, extraDiskPaths=[]) {
  const start=performance.now();root=resolve(root);
  const directories=Object.fromEntries(Object.entries(GROUPS).map(([name,p])=>[name,{bytes:0,status:existsSync(join(root,p))?'CREATED':'NOT CREATED'}]));
  let used=0,filesScanned=0,linksSkipped=0,externalLinks=0,races=0;
  function transient(error) {if(['ENOENT','ENOTDIR'].includes(error.code)){races++;return true;}return false;}
  function walk(path) {
    let entries;
    try { entries=readdirSync(path,{withFileTypes:true}); } catch(error) {if(transient(error))return;throw error;}
    for(const item of entries) {
      const full=join(path,item.name);
      try {
        if(item.isSymbolicLink()) {linksSkipped++;if(!inside(root,realpathSync(full)))externalLinks++;continue;}
        if(item.isDirectory()) walk(full);
        else if(item.isFile()) {
          const stat=lstatSync(full);if(!stat.isFile()){races++;continue;}
          const bytes=stat.size;used+=bytes;filesScanned++;
          const rel=relative(root,full).split(sep).join('/');
          for(const [name,p] of Object.entries(GROUPS)) if(rel===p||rel.startsWith(p+'/'))directories[name].bytes+=bytes;
        }
      } catch(error) {if(!transient(error))throw error;}
    }
  }
  walk(root);
  const disks=[],seen=new Set();
  for(const [i,path] of [root,...extraDiskPaths.filter(p=>p&&existsSync(p))].entries()) {
    const device=String(statSync(path).dev);
    if(seen.has(device)) continue;seen.add(device);
    const d=statfsSync(path);
    disks.push({role:i===0?'workspace':'runner-tool-cache',free:Number(d.bavail)*Number(d.bsize),total:Number(d.blocks)*Number(d.bsize)});
  }
  return {free:disks[0].free,used,directories,disks,filesScanned,linksSkipped,externalLinks,races,scanMilliseconds:Math.round(performance.now()-start)};
}
export function assertMeasurement(m,policy,additionalGiB=0) {
  checkSpace({...m,reserve:policy.diskReserveGiB*1024**3,additional:additionalGiB*1024**3,cap:policy.workspaceCapGiB*1024**3});
  if(m.disks.some(d=>d.free<policy.diskReserveGiB*1024**3))throw new Error('BLOCKED: cache disk reserve');
  if(m.externalLinks)throw new Error('BLOCKED: external workspace link cannot be budgeted');
  return true;
}
export async function downloadVerified(spec,fetcher=fetch,{url=spec.url}={}) {
  if(url!==spec.url)throw new Error('Unexpected download address');
  const initial=new URL(spec.url);
  for(let redirects=0;redirects<=3;redirects++) {
    const u=new URL(url);
    const allowed=u.protocol==='https:' && !u.username && !u.password && (url===spec.url ||
      (initial.hostname==='github.com' && ['release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(u.hostname)));
    if(!allowed)throw new Error('Unexpected download origin');
    const response=await fetcher(url,{redirect:'manual',signal:AbortSignal.timeout(60000)});
    if(response.status>=300&&response.status<400) {url=new URL(response.headers.get('location'),url).href;continue;}
    if(response.status!==200)throw new Error('Asset HTTP status '+response.status);
    const max=spec.bytes ?? 32*1024**2;const chunks=[];let size=0;
    for await(const chunk of response.body) {
      size+=chunk.length;if(size>max)throw new Error('Asset size limit');
      chunks.push(Buffer.from(chunk));
    }
    const bytes=Buffer.concat(chunks);verifyBytes(bytes,spec);return bytes;
  }
  throw new Error('Asset redirect limit');
}
export async function obtainVerified(root,path,spec,fetcher=fetch) {
  assertOwnedPath(root,path);
  if(existsSync(path)) {const bytes=readFileSync(path);verifyBytes(bytes,spec);return bytes;}
  const bytes=await downloadVerified(spec,fetcher);
  mkdirSync(dirname(path),{recursive:true});writeFileSync(path,bytes,{flag:'wx'});return bytes;
}
function exactKeys(value,keys) {
  if(!value||typeof value!=='object'||Array.isArray(value)||JSON.stringify(Object.keys(value).sort())!==JSON.stringify([...keys].sort()))throw new Error('Evidence schema whitelist');
}
function safeText(text) {
  if(/(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}|-----BEGIN .*PRIVATE KEY|Bearer\s+[A-Za-z0-9_.-]{20,})/.test(text))throw new Error('Sensitive text evidence');
}
export function safeRelative(file) {
  if(typeof file!=='string'||!file||file.length>500||file.includes('\\')||file.includes(':')||file.startsWith('/')||/[\x00-\x1f\x7f]/.test(file)||file.split('/').some(p=>p==='.'||p==='..'||p===''))throw new Error('Unsafe evidence path');
  safeText(file);
}
const CHECKS=['electron','host','native','ffmpeg','openreel','director','plugins','updaterDisabled','runtimeDenied'];
export function makeSummary(manifest,raw) {
  exactKeys(manifest,['schemaVersion','commit','applicationId','productName','files','bytes','checks','candidateLaunched','binaryUploaded']);
  if(manifest.schemaVersion!==1||!/^[a-f0-9]{40}$/.test(manifest.commit)||manifest.applicationId!==ID||manifest.productName!==NAME)throw new Error('Wrong evidence identity');
  if(manifest.candidateLaunched!==false)throw new Error('Candidate was launched');
  if(manifest.binaryUploaded!==false)throw new Error('Binary was uploaded');
  exactKeys(manifest.checks,CHECKS);
  if(CHECKS.some(k=>manifest.checks[k]!==true))throw new Error('Incomplete resource checks');
  if(!Array.isArray(manifest.files)||!manifest.files.length||manifest.files.length>40000)throw new Error('Invalid manifest files');
  let total=0;const paths=new Set();
  for(const entry of manifest.files) {
    exactKeys(entry,['file','bytes','sha256']);safeRelative(entry.file);
    if(!entry.file.startsWith('win-unpacked/')||paths.has(entry.file.toLowerCase()))throw new Error('Invalid manifest path');
    paths.add(entry.file.toLowerCase());
    if(!Number.isSafeInteger(entry.bytes)||entry.bytes<0||!/^[a-f0-9]{64}$/.test(entry.sha256))throw new Error('Invalid file bytes or digest');
    total+=entry.bytes;
  }
  if(!Number.isSafeInteger(total)||total!==manifest.bytes)throw new Error('Manifest bytes mismatch');
  const exe=manifest.files.find(f=>f.file==='win-unpacked/shotloom-local-test.exe');
  if(!exe||exe.bytes<=0)throw new Error('Missing candidate EXE');
  safeText(raw);
  return {schemaVersion:1,commit:manifest.commit,applicationId:ID,exe:{path:exe.file,sha256:exe.sha256,bytes:exe.bytes},
    directoryBytes:total,fileCount:manifest.files.length,manifestSha256:digest(raw),checks:manifest.checks,candidateLaunched:false,binaryUploaded:false};
}
export function validateEvidence(manifest,summary,raw) {
  // Property order may differ, values/schema may not.
  const expected=makeSummary(manifest,raw);
  function canonical(x) {return x&&typeof x==='object'?Array.isArray(x)?x.map(canonical):Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;}
  if(JSON.stringify(canonical(expected))!==JSON.stringify(canonical(summary)))throw new Error('Evidence summary mismatch');
  return true;
}
export function readEvidenceFile(root,path) {
  assertOwnedPath(root,path);
  const name=relative(dirname(path),path);
  if(!['candidate-summary.json','candidate-manifest.json'].includes(name))throw new Error('Text evidence filename whitelist');
  const max=name==='candidate-summary.json'?16384:8*1024**2;
  const stat=lstatSync(path);if(!stat.isFile()||stat.size<2||stat.size>max)throw new Error('Text evidence size/type limit');
  const bytes=readFileSync(path),text=bytes.toString('utf8');
  if(!Buffer.from(text).equals(bytes))throw new Error('Evidence must be UTF-8');
  safeText(text);JSON.parse(text);return text;
}
export function prepareTextEvidence(root,policy) {
  if(policy.textEvidenceUploadApproved!==true||!executionModes(policy).build)throw new Error('Text evidence upload not authorized');
  const source=join(root,'release/batch09'),target=join(root,'tmp/batch09/text-evidence');
  const names=['candidate-summary.json','candidate-manifest.json'];
  const texts=names.map(n=>readEvidenceFile(root,join(source,n)));
  validateEvidence(JSON.parse(texts[1]),JSON.parse(texts[0]),texts[1]);
  assertOwnedPath(root,target);
  if(existsSync(target))throw new Error('Text evidence staging must be fresh');
  mkdirSync(target,{recursive:true});
  return names.map((n,i)=>{const path=join(target,n);writeFileSync(path,texts[i],{flag:'wx'});return path;});
}
