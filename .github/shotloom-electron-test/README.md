# BATCH-13 bounded Windows candidate preparation

Only for test/windows-electron-candidate. Never include these helpers in the upstream memory PR.

## Approvals and modes
- BATCH-11 already used validationExecutionApproved=true. That historical value does not authorize another push or rerun.
- fullBuildApproved, dependencyScriptsReviewed, candidatePackagingApproved, localRunAuthorized, binaryUploadAuthorized remain false.
- textEvidenceUploadApproved defaults false and requires separate explicit approval. It never authorizes a binary upload.
- Validation mode ends normally after root ignored-script ci and four Node22 checks. All eight build steps stay skipped.
- Full-build stages require all build approvals and current-commit successful Node22 evidence. No GUI, installer, signing, release, custom secrets or paid runner.

## Controlled dependency paths
- Root/director npm ci use --ignore-scripts. Host now also uses --ignore-scripts: node-pty, koffi, esbuild and better-sqlite3 install scripts cannot fall back to node-gyp/CMake/network installation.
- Host must contain exact locked Windows x64 prebuilt files. It then performs in-memory SQLite, native loader and esbuild transform checks. Missing or unloadable files stop the stage; no compilation fallback is attempted.
- FFmpeg package stays 5.3.0, binary b6.1.1/6.1.1. controlled-deps verifies compressed and expanded SHA256 before writing or executing either root or sidecar executable. Wrong existing cache/executable stops instead of being trusted.
- FFMPEG_BIN is pinned to that verified executable. The package stage verifies it and the sidecar again; resource verifier hashes the copied binary before -version. The upstream product scripts are unchanged.
- Fixed-SRI pnpm@11.7.0 is downloaded/extracted into owned scratch using the existing locked tar module. No npx/global install. Its package/entry/bundle digests are checked before use.
- The command guard allows only frozen install with --ignore-scripts and explicit workspace store, core build:wasm, web build:embedded. Unexpected install/add/env/setup/deploy is denied. Dependency-script ignore is stricter than the existing workspace allowBuilds list (which is unchanged); explicit reviewed project build scripts still run.
- pnpm run dependency-status checks warn instead of automatically installing. CLI entry needs Node>=22.13 and runs on pinned Node22.19.0.
- Official Electron44.10.2 installer remains exactly once in official packaging, with packaged SHA256 checksums. No Rust/MSVC/SDK is installed by these helpers; any missing native prebuilt stops.

## Space and cache accounting
- npm, pnpm, FFmpeg LOCALAPPDATA cache, APPDATA, Electron/builder cache, Node compile cache and TEMP/TMP are workspace-local process environment overrides, never global settings.
- Initial inventory has no capacity gate. Each stage start/end and ~5-second interval uses one workspace traversal with overlapping directory counters; category bytes must not be summed.
- Root/Host/director deps, stores/caches, Electron, FFmpeg, resources, dist, candidate and tmp/logs are reported separately. Missing directories are zero/NOT CREATED.
- Internal pnpm links are skipped to avoid duplicate traversal; external links stop budget enforcement. Normal ENOENT/ENOTDIR races are counted; other errors remain failures.
- Workspace disk plus the official runner tool-cache volume are sampled. Tool-cache (setup-node) is outside the project cap, but its free-space reserve is checked.
- Keep 10GiB reserve, 8GiB workspace logical cap, 25min stage and 90min job. Sampling is discrete, not a hard filesystem quota or proof of an unobserved true peak; scanMilliseconds/races describe limitations.

## Text evidence, never binaries
- Successful verifier writes candidate-summary.json and full per-file candidate-manifest.json under release/batch09.
- A bounded standalone CANDIDATE_SUMMARY_JSON record is printed outside the last-20000-character log tail and again by final summary. It includes Commit/ID, EXE relative path/SHA256/bytes, candidate total/files, manifest digest and resource checks.
- runtimeDenied/updaterDisabled represent static bundled guard checks plus helper tests, not a real candidate GUI launch. candidateLaunched=false remains explicit.
- Text staging requires a successful current-SHA resources result and separate text approval, then validates exact schemas, paths, UTF8, sensitive patterns, sizes and manifest/summary equality before copying only two files to a fresh directory.
- Summary cap16KiB, manifest cap8MiB/40000 entries. Over-limit evidence fails rather than broadening upload scope.
- Workflow upload is pinned official actions/upload-artifact, default disabled, two exact JSON paths, no glob, retention1day. EXE/DLL/ASAR/database/cache/source directories are never selected.
- Public Fork text artifacts can be publicly readable. Separate approval is required even though they contain only metadata. No binary distribution rights are inferred from a public Fork.
- Without future approved binary delivery, the runner's candidate disappears with the job.

## Local checks
node --test .github/shotloom-electron-test/candidate.test.mjs .github/shotloom-electron-test/audit.test.mjs
Local Node24 helper results do not substitute for actual Windows Node22, native loading, full packaging or 130-second manual acceptance.
