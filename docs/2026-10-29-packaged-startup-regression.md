# Windows 1.5.47 packaging correction

1.5.46 failed on startup because the distributed dependency tree omitted graceful-fs required by fs-extra/electron-updater. Prior source tests, successful packaging and artifact checksums did not establish runtime dependency completeness or actual packaged startup. The release was withdrawn from the public update feed (1.5.45 restored temporarily) and marked prerelease on GitHub.

Built again from a dedicated npm ci tree inside the isolated release checkout, replacing only that checkout's dependency junction; the primary checkout and user configuration were not modified. New release 1.5.47 retains the backlog protection.

Mandatory afterPack verification traverses the production dependency graph inside app.asar, resolving hoisted/nested/scoped packages, excluding dev-only and optional platform packages. A missing dependency aborts packaging. Windows build also runs the packaged executable in an explicit startup smoke mode with a new temporary userData directory, reaching app.whenReady and writing version/isPackaged proof, then exiting before auto-update, renderer, credentials or bridge setup. No real print can be sent by this test.

Regression unit tests cover the missing graceful-fs chain, nested/scoped resolution and optional/dev exclusion. Packaged Windows 1.5.47 passed dependency closure verification and isolated executable startup. Physical printing remains separate. User recovery requires installing 1.5.47 manually when 1.5.46 cannot launch; no userData deletion or reconfiguration is needed.
