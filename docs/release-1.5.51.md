# Mangiamo Desktop 1.5.51 — Windows

- Prints the saved per-section font, size, weight, alignment, spacing and block order from the visual editor.
- Keeps dish notes and guests with the corresponding dish and wraps within the configured physical head.
- Retains the additional three blank lines below the table PIN before cutting.
- Uses verified, deduplicated downloads and silent update/relaunch; waits for active print transfers and pending metadata checks.
- Offers read-only paper detection for documented Epson TM-T70/TM-T70II responses. Unsupported or missing responses retain manual paper selection.

This Windows installer was built and startup-verified locally. No GitHub Actions build was used. The previously verified 1.5.50 files remain preserved locally; its old updater cannot implement the new behavior retroactively.

The first update from an older installed version may still show its existing assisted installer. Subsequent update behavior is controlled by this corrected native build. Physical paper geometry and a real installed version-to-version replacement/relaunch remain separate checks.
