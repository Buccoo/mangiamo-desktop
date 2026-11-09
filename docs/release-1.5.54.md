# Mangiamo Desktop 1.5.54 — precise point sizes

- Supports freely entered 4–72 point text sizes, including decimals, for kitchen sections and non-fiscal receipt sections/total.
- Uses the same pinned fonts and deterministic monochrome pixels as Manager/staff previews. Font size is converted using destination DPI, independently of the printer's built-in fonts and normal/double size modes.
- Supports standard ESC/POS raster graphics and a compatibility column-image mode. Graphic mode is chosen before dispatch; it is never retried with another protocol after bytes may have been sent. Compatibility mode explicitly selects motion units for 180/203 dpi; 300 dpi uses standard raster mode.
- Retains destination-scoped CUSTOM model geometry and protects large glyph bearings, wrapping and receipt price columns. Bundled OFL fonts cover Latin, accents, Chinese and common menu symbols/emoji; an unavailable glyph is reported before physical dispatch.
- Keeps legacy native layouts and PIN output unchanged. Serial leases, durable delivery journals and acknowledgement-only recovery remain active.

Manager/staff verify active print agents before saving point-size layouts and require Desktop 1.5.54 or later. Unknown/unreachable paper information retains explicit manual setup. Precise output requires a supported ESC/POS graphic transport and correct physical width/DPI; this release does not add office-printer drivers or upgrade an older Android bridge.

Built locally with no GitHub Actions build. Packaged startup renders Latin, Chinese and emoji with the actual bundled font files, without opening a user session, renderer, bridge or physical printer. The release gate requires that font proof in addition to installer/manifest integrity.

Automated pixel/transport checks and real-browser selection/drag/responsive checks passed. Physical print appearance and version replacement on remote PCs remain device checks. Font licenses and pinned upstream revisions/hashes are included under assets/printing.
