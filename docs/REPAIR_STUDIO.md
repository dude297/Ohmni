# Repair Studio (backend, post-submission)

Flow: Observe (user voltages) -> Diagnose (`probeStep` posterior) -> Propose -> Simulate (MNA solver) -> Approve (human) -> Verify (follow-up measurement).

Labels: **measured** (user), **simulated** (solver), **hypothesized** (probe), **verified** (follow-up measurement). Nothing is "fixed for certain"; verification is "consistent with the repair".

## Endpoints
- `POST /api/repair` `{ graph, userConfirmed: true, observations[1..50] }` -> `{ result: { proposals (top 3, p >= 0.05, no nominal), basis, safety, trace } }`. Errors as `/api/probe`: BAD_JSON 400; INVALID_REQUEST / NOT_CONFIRMED / INVALID_GRAPH / UNSOLVABLE 422.
- `POST /api/repair/verify` `{ graph, userConfirmed: true, hypothesisId (or proposal.hypothesisId), measured, revisionId? }` -> `{ result: { verified, status, delta, message, node, expectVolts, toleranceVolts, hypothesisId, revisionId, basis: 'server_recomputed', clientExpectationIgnored? } }`. **Server-authoritative:** the hypothesis must be a valid fault id of the posted graph (else 422 UNKNOWN_HYPOTHESIS); the verification node, expected volts (solve of the confirmed design) and tolerance (2 % + 10 mV) are recomputed server-side. Client `proposal.verification` is accepted for backward compatibility but ignored (`clientExpectationIgnored: true` if it differs). `measured.node` must exist (else 422 UNKNOWN_NODE) and equal the server's verification node to verify (else not_verified). `revisionId` (also returned by `/api/repair`, sha256 of the canonical graph) mismatch -> 409 REVISION_MISMATCH. `verified` means the reading is consistent with the simulated repaired design; Ohmni never claims a physical repair.

## Safety rules
- Patches are `restore_design` only: set one component back to its confirmed design value. A source is never raised above its confirmed voltage.
- Patched graph must pass `validateGraph` and solve; otherwise the proposal is dropped.
- Actions always start with power-down; resistance is never measured energized.
- `resolves` = every observation within tolerance of the simulated faulted model AND the repaired design differs meaningfully at an observed node.

## Future (not in this version)
Topology rewiring (wrong-node wiring). `/api/topology` would be the discriminator for wiring faults before any rewiring patch is proposed.
