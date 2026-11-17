# Mandatory desktop release checks

Use a clean npm ci dependency tree for the exact checkout/version. Never package from a dependency junction or a shared dirty checkout.

Before publishing Windows, run npm test, npm run typecheck and npm run build:win. The build aborts when afterPack finds an incomplete production graph in app.asar. It then starts the packaged executable in isolated smoke mode and writes packaged-startup-proof.json, bound to the installer SHA512 and size. The release gate verifies proof, version, installer and latest.yml together. Any artifact change invalidates the receipt: rebuild and rerun the packaged test. Run npm run verify:release immediately before manual upload; do not substitute source-only tests or a successful compiler/build exit for this gate.

GitHub Windows build runs source tests/typecheck, packaging verification and actual packaged startup before artifact upload. The release job checks the downloaded receipt against the exact installer before creating a public release. The update-feed job checks again before publishing the download/update feed. No continue-on-error, missing-evidence fallback or unchecked artifact substitution is allowed.

macOS packaging already receives the afterPack dependency check; packaged runtime execution must be proved on the target architecture before describing a macOS build as runtime-verified. Windows evidence does not prove macOS, hardware/network printing or a live restaurant service.

The isolated startup test exits before opening user credentials, renderer, updater or print worker. It cannot print restaurant jobs. Keep the produced verification receipt with release artifacts. Do not remove userData or reuse a restaurant session for smoke testing.
