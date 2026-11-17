# Print backlog review — Windows 1.5.46

Before starting the worker, call print_hold_startup_jobs. Fail closed on missing RPC, authorization/network error or an unconfirmed receipt. No polling, claims, receipt processing or TCP sends start until the startup review succeeds. Concurrent starts share one promise; stopping or switching restaurant during startup cannot revive the worker.

Server holds unsent kitchen/PIN/test jobs for explicit review. Existing bridges also receive resume protection through the printing_agents AFTER trigger on a stopped/stale heartbeat; a healthy second bridge is left alone. The new build is required for immediate application restarts where the previous heartbeat may still appear fresh. Normal live reconnects do not automatically drop jobs. Pending print review never changes an order, payment or fiscal document.

Windows installer SHA512 and size were checked against latest.yml; public production runtime has been validated. Unit tests exercise held startup, failure, concurrent starts, stop and tenant switch. Physical paper/LAN proof remains separate. Existing unrelated primary checkout changes are not included.
