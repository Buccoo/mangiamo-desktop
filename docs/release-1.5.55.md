# Mangiamo Desktop 1.5.55 — fast or custom ticket printing

- Choose Fast native text or Custom graphics independently for kitchen tickets and non-fiscal receipts. Fast uses the printer's native sizes; Custom keeps decimal point sizes and the shared pixel preview. Switching preserves the saved point values for returning to Custom.
- Layouts without an explicit mode retain their previous behavior: legacy native tickets remain native and existing point layouts remain graphical. Manager/staff require an active Desktop 1.5.55+ before saving an explicit mode so an older consumer cannot ignore Fast while printing dormant point sizes graphically.
- Standard GS-v0 graphics now groups up to 256 rows per command, bounded to 32 KiB. The 576 × 696-dot regression sample uses three commands instead of 29 with identical pixels and one final cut. ESC-star compatibility output is unchanged. Physical throughput remains printer-dependent and requires a device check.
- Durable journals, serial claims, pre-send-only retries, uncertain-delivery protections and PIN output remain unchanged. No automatic protocol fallback occurs after sending.

Built and packaged locally; no GitHub build. Packaged startup checks actual Latin, Chinese and emoji rendering. Automated mode, pixel, delivery and release checks are recorded with the Manager QA report; no physical printer was driven during release validation.
