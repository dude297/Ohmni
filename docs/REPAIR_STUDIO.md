# Repair Studio (backend, post-submission)

Merged through [#69](https://github.com/dude297/Ohmni/pull/69), with source clients in `/build`, `/twin` and `/for-the-larp/voice-lab`. These integrations still require their own hosted user-flow evidence; a simulated proposal never performs a physical repair.

Flow: Observe (user voltages) -> Diagnose (`probeStep` posterior) -> Propose -> Simulate (MNA solver) -> Approve (human) -> Verify (follow-up measurement).

Labels: **measured** (user), **simulated** (solver), **hypothesized** (probe), **verified** (follow-up measurement). Nothing is "fixed for certain"; verification is "consistent with the repair".

## Endpoints
- `POST /api/repair` `{ graph, userConfirmed: true, observations[1..50] }` -> `{ result: { proposals (top 3, p >= 0.05, no nominal), basis, safety, trace } }`. Errors as `/api/probe`: BAD_JSON 400; INVALID_REQUEST / NOT_CONFIRMED / INVALID_GRAPH / UNSOLVABLE 422.
- `POST /api/repair/verify` `{ graph, userConfirmed: true, proposal: { hypothesisId, verification }, measured }` -> `{ result: { verified, status, delta, message } }`. Verified only if `measured.node === verification.node` and `|volts - expectVolts| <= toleranceVolts` (2 % + 10 mV).

## Safety rules
- Patches are `restore_design` only: set one component back to its confirmed design value. A source is never raised above its confirmed voltage.
- Patched graph must pass `validateGraph` and solve; otherwise the proposal is dropped.
- Actions always start with power-down; resistance is never measured energized.
- `resolves` = every observation within tolerance of the simulated faulted model AND the repaired design differs meaningfully at an observed node.

## Future (not in this version)
Topology rewiring (wrong-node wiring). `/api/topology` would be the discriminator for wiring faults before any rewiring patch is proposed.
