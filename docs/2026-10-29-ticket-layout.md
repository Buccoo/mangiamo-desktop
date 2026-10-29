# Ticket layout — Desktop 1.5.49

Kitchen transport now uses the saved `printing.ticket_layout.kitchen` instead of a hardcoded text format. Large means ESC/POS 2x width and height, with corresponding wrapping. Alignment, font, emphasis, field visibility and footer are respected. PIN slips retain their existing minimal format and cut sequence. Fiscal emission/copy rendering is unchanged; non-fiscal receipts use their saved layout through a separate shared renderer.

Ordinary jobs load current restaurant formatting. Explicit layout-test jobs carry the preview sample and saved layout snapshot, so a subsequent settings change cannot alter that test. A failed live settings read prevents ordinary kitchen/non-fiscal transport rather than silently printing a different format.

The portable kitchen source matches web and staff app. Non-fiscal rendering matches web. Printer width is characters per line, not millimetres; selected width must fit the printer's printable area. Font A/B dot geometry and ESC/POS commands require physical validation on the restaurant hardware, including character encoding, margins and cutter.

Validation: 50 desktop tests passed; one pre-existing external fiscal-evidence fixture was skipped. Typecheck passed. Windows installer produced through the mandatory production-dependency closure, real packaged startup and installer/manifest hash gates. Compiled kitchen, non-fiscal and worker modules extracted from app.asar match the tested modules. No real restaurant jobs or physical print requests were created during QA.

Windows-only release. The macOS compatibility manifest keeps its existing immutable asset URLs; this release does not provide a new macOS binary.

Paper profile is explicit (384/512/576/960 printable dots). Character wrapping is independently bounded by that area; a font change cannot move the center of the paper. The usual 58/80 mm profiles must be checked against the actual printer model.
