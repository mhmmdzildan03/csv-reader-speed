# csv-reader-speed

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/mhmmdzildan03/csv-reader-speed/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/mhmmdzildan03/csv-reader-speed/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A fast drop-in replacement for csv-reader 1.0.0: `solve.js` answers every
`{text, header}` input with exactly csv-reader's `{columns, rows, errors}` —
broken rows, stray CRs, quote junk and unterminated quotes included — while
`main.ts` is the standard harness driver that reads `/input/cases.json` and
writes `/output/answers.json`.

Where the reference builds each field one character at a time, this reader
jumps between delimiters with `indexOf` and slices each clean run of
characters out of the text in one piece. The next LF and CR positions are
cached and rescanned only once the reader passes them, so an ordinary field
costs a single short `indexOf` for its comma, and the field readers return
through shared variables so a field allocates nothing but its string. Only
the rare broken paths (a stray CR inside a field, a doubled quote, a CR
inside quotes, junk after a closing quote) assemble a field from parts. On the kit's practice set it answers all
6 cases identically at roughly 6.6x the reference's speed. Dependency-free,
deterministic, nothing kept from one call to the next.

## Run it

```sh
node main.ts
```

Reads `/input/cases.json` (or `$MAKEFUN_INPUT_DIR/cases.json`), writes
`answers.json` to `/output` (or `$MAKEFUN_OUTPUT_DIR`).

---

<sub>Entered on [make.fun](https://make.fun/?ref=n8m845w8&utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
