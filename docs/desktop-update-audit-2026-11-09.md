# Native Windows updater verification — 9 November 2026

The main process now accepts an installer as ready only after electron-updater emits `update-downloaded`, following its integrity verification. A resolved download promise alone cannot fabricate readiness. Concurrent downloads share one transfer, repeated install requests share one scheduled installation, and updater errors cancel stale scheduled callbacks before retry.

Installation uses `quitAndInstall(true, true)` for silent NSIS replacement and application relaunch. The installed electron-updater dependency was exercised to confirm the resulting `--updated`, `/S`, `--force-run` and existing-directory arguments. The worker processing state is checked both before acknowledging install and immediately before the scheduled invocation; active work returns `PRINT_JOBS_ACTIVE`. This protects the active polling/printing cycle, rather than promising the entire remote queue is empty.

Polling preserves verified metadata and never changes provider while downloading or installing. Recovery may switch the existing feeds on temporary HTTP/network failures while idle. A metadata check that started before a download cannot switch provider after the transfer begins. Windows fallback uses the same verified native pipeline and respects disabled updates; the former manually launched, header-only-validated EXE path is no longer reachable on Windows.

The main process also exposes the printer-paper capability through `desktopShell.printer.detectPaper({ host, port? })`. It refuses queries while the worker is processing and forwards idle requests to the documented-model detector. The detector does not print, cut, reset or change printer configuration.

## Existing package and local build requirement

The existing prebuilt 1.5.50 archive was inspected directly. It contains `quitAndInstall(false, true)`, manufactures downloaded state on a fulfilled promise, and has no `desktopUpdate.cjs` controller. It cannot deliver these native fixes by updating the remote renderer. Its installer, blockmap, channel metadata and startup proof have been preserved under `dist-desktop/prebuilt-1.5.50` before any new packaging.

A new native patch package is required. Package/version promotion is coordinated separately; this patch does not publish, deploy, alter the production feed, run a GitHub workflow or replace the installed application.

## Verification and remaining limits

Controller tests cover integrity-event readiness, transfer/install deduplication, failures and retry, print-cycle guards and cancellation of stale callbacks. Integration tests run the actual compiled main-process logic and preload bridge in isolated VMs, including verified Windows recovery and provider stability. They do not close a real application or replace a real installation.

An installed old build still controls its first upgrade using its old assisted flags. Installing the corrected build once is needed before an old-to-new trial can demonstrate silent replacement and relaunch to a subsequent higher version. That trial must also confirm preserved login/printer configuration and that repeated clicks or interrupted network transfers leave a usable application. Windows elevation may still be required according to the installation owner. macOS automatic replacement is not established by the Windows tests.
