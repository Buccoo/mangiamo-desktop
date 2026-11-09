# Mangiamo Desktop 1.5.53 — Windows

- Recognizes CUSTOM KUBE II ETH from its two fixed read-only web information pages. Verified on the connected printer: firmware 1.34, head T80. No test ticket, feed, cut, reset or settings request is sent by identification.
- Distinguishes directly reported Epson paper information from a CUSTOM model profile. KUBE II's protected active setup is not read or guessed: its profile uses a conservative 576-dot / 72mm print area within both documented 76/80mm areas. The 80mm description is a nominal compatible roll profile, not a physical measurement.
- Stores a model profile only for its exact host and raw TCP port. Other printers retain their previous geometry and receive no CUSTOM-only commands.
- Uses CUSTOM's documented 14x24 Font A and 10x24 Font B geometry with per-ticket CPI selection. Wrapping, separators, preview cells and native output share the resolved destination profile, including layout-test snapshots.
- Preserves the 1.5.52 low-latency loop, serial leases, durable journals and acknowledgement-only recovery. Duplicate-delivery protections are unchanged.

Built, dependency-checked and packaged-startup verified locally. No GitHub Actions build is requested. Epson TM-T70/TM-T70II direct width detection remains available; unknown or unavailable devices retain manual selection. Detection is bounded and never executes device-page JavaScript, follows redirects, logs into the printer or writes its configuration.

Primary manufacturer references: CUSTOM DOMC-0006I command manual (https://www.odeca.it/odeca/wp-content/uploads/2017/08/KUBE.pdf), and KUBE II ETH user guide 769000000332_2.01 (https://www.idcardworld.com.au/documents/printers_kubeII/Custom%20KUBEII%20Ethernet%20User%20Manual.pdf). These are manufacturer documents hosted by distributors.

The printer's built-in font face remains a visual approximation in the preview; arbitrary point sizes/raster rendering are a separate change. Physical output after applying this profile and silent installation on remote PCs remain device checks.
