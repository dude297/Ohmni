# Firmware ADC debugging (moonshot prototype)

Cross-domain check: does the firmware's reported ADC value agree with the circuit it measures?
Local, deterministic, no model calls. Code under `src/lib/firmware/`, route `POST /api/firmware/adc`.

## Workflow

1. Circuit (confirmed `CircuitGraph`) gives the EXPECTED pin voltage via `solveDC`.
2. User measures the pin with a meter -> MEASURED volts.
3. Firmware reports a voltage (serial log) and/or raw counts -> REPORTED.
4. `analyzeAdc` varies ONE firmware assumption at a time and scores how well each reproduces the reported value from the measured pin voltage:
   - Vref in {1.1, 1.2, 2.048, 2.5, 3.3, 5.0} (hardware differs from what the code assumes),
   - bits in {8, 10, 12, 16}, divider factor (1 / as-solved-from-circuit vs as configured), both scaling conventions (`/(2^n-1)` vs `/2^n`).
   - `circuit_fault` when measured differs from expected by more than 2% + 10 mV: flagged with `handoff: "probe-guide"`.
5. Optional pasted code (<= 8 KB) is scanned statically (`codecheck.ts`) for `#define VREF`, `const float VREF =`, `analogReadResolution(n)`, `/ 1023|4095|65535`, trailing `* 2.0` factors, `analogReference(...)`, MicroPython `read_u16()`. A PROPOSED unified-diff-style patch is returned for the best diagnosis. It is never applied.

Config semantics: `AdcConfig` is what the FIRMWARE believes. Vref/bits candidates are what the HARDWARE might really be (fix = change the code to match). For divider ratio, `dividerRatioInCode` is the ratio the code is expected to apply; a candidate ratio is what the code actually applies (fix = make code match the config).

If `config` is omitted and `code` is given, config is derived from the scan (needs a VREF constant and a resolution/divisor).

Tolerance: volts `max(1 mV, 1 LSB of the configured ADC)`, counts 1. If the configured model already fits, `best` is `consistent` and other fits within tolerance are listed in `ties` (e.g. `/4095` vs `/4096` is reported as minor/inconclusive). If nothing fits, `confident:false` and no correction is proposed.

## What is verified (tests/firmware/adc.test.ts)

Reference case: 5 V supply, R1 = R2 = 10 k, ADC pin node `VOUT` = 2.500 V (`solveDC`). MCU really runs at Vref 3.3 V, 12-bit; code says `#define VREF 5.0` and `/ 4095.0`. True counts = round(2.5/3.3*4095) = 3102; firmware reports 3102*5/4095 = 3.78755 V. Analysis picks `vref_3.3` (vref_mismatch), predicted reported matches within 1 mV (error ~0), circuit judged fine (measured 2.50 = expected 2.50), proposed diff `-#define VREF 5.0` / `+#define VREF 3.3`. Also covered: 10-bit vs 12-bit, missing divider factor, `/4096` vs `/4095` (minor, tied), measured 0.45 V -> `circuit_fault`, code scan, 8 KB limit (HTTP 413), route errors.

## Limits

- Pasted firmware is never executed, compiled or evaluated; regex scan only, one ADC channel, simple one-line patterns.
- Ideal ADC: round-to-nearest, no offset/gain/INL error, no noise.
- No source impedance / sampling-capacitor / settling effects yet (high-impedance dividers read low on real MCUs).
- Single-assumption candidates only; two simultaneous bugs may show as "not confident".
- Response `trace` is returned both inside `result` and at top level.

## UI idea (ChatGPT Work or a Claude-owned route)

Three big numerals side by side: EXPECTED (circuit solve), MEASURED (meter), REPORTED (firmware), each with its unit; colour the odd one out. Under them the winning diagnosis title and evidence line, a "tied with" chip list from `ties`, and the `proposedDiff` in a monospace block labelled PROPOSED (not applied) with a copy button. If `handoff === "probe-guide"`, replace the diff with a "Circuit looks wrong, open Probe Guide" button.
