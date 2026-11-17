# BATCH-10 candidate preparation

Only for test/windows-electron-candidate; never include these helpers in the upstream memory PR.

- Merge preserves BATCH-09 history; latest upstream is pinned in policy.json.
- Independent validationExecutionApproved and fullBuildApproved default false. Validation-only runs root npm ci --ignore-scripts and the four Node22 checks, then ends normally. Build steps are skipped, not deliberately failed.
- Full build additionally requires dependencyScriptsReviewed and candidatePackagingApproved. Every build stage checks current-commit successful Node22 result records, even if called outside the workflow step order.
- Root lockfile dependencies are the minimal official reproducible setup for typechecking and these tests; no Host/director/OpenReel install or Electron/FFmpeg runtime download in validation mode.
- The official electron-package.mjs now installs the exact locked Electron runtime itself, once before building. There is no separate electron-dist stage. Keep its installer/error handling and new npm dispatch; do not roll upstream back.
- Host resource verification compares the prepared production closure against the packaged copy, not development node_modules. Native binding and FFmpeg checks occur only in separately approved build mode; no GUI launch.
- Inventory precedes every capacity gate. Keep the unmeasured conservative 10 GiB reserve / 8 GiB workspace cap, with per-stage incremental bounds. Standard 14 GB Runner may be BLOCKED. No system cleanup or paid runner.
- Native lifecycle/source review remains incomplete. Locks include npmmirror origins. No versions/URLs are rewritten.
- Candidate identity remains com.shotloom.localtest.batch09 deliberately: compatibility update to the same candidate. Bootstrap/launcher localRunAuthorized stays false. Same-user path isolation is not an OS sandbox; no runtime acceptance claimed.
- No artifact/cache upload, signing, release, secrets or desktop launch. Binary distribution requires separate rights/channel/size authorization; Runner contents are ephemeral.
- Local commands: node --test .github/shotloom-electron-test/candidate.test.mjs. Source checks do not substitute for Windows Node22, native packaging, or manual 130-second acceptance.
