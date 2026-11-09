# Mangiamo Desktop 1.5.52 — Windows

- Reduces legacy 2500ms polling settings to at most 1000ms and counts network time toward the idle interval.
- Continues immediately after processing queued work, while claiming and delivering one operation at a time.
- Refreshes agent presence every 15 seconds instead of on every poll. Server authorization, claim renewal and acknowledgement still run for every delivery.
- Reads live printer settings only when a ticket or non-fiscal receipt needs them; layouts remain fresh for each delivery.
- Rotates the three receipt queues fairly instead of querying all of them on every kitchen poll.
- Preserves startup backlog review, durable delivery journals, uncertain-delivery holds and acknowledgement-only recovery. A lost acknowledgement never triggers a second physical send.
- Cancels dispatch before the transport starts if the service or restaurant changes while awaiting configuration or renewal. Transfers already in progress retain their existing completion/uncertainty handling.

Built and packaged-startup checked locally, with no GitHub Actions build. Regression tests cover idle cadence, legacy settings, queue draining, receipt fairness, missing receipt RPCs, overlapping ticks, stopping before dispatch, and lost acknowledgements for both kitchen and receipts.

The one-second target is the idle software polling cadence, not a guarantee of paper-start time: network latency, server scheduling, other pending documents and printer readiness still apply. Physical 5–10 second latency must be remeasured on the restaurant printer after installation.
