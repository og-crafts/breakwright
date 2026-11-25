# Benchmark, 2026-11-24 (`scripts/benchmark.mjs`, raw: benchmark.json)
20 bugs planted in the demo shop, one at a time, against three suites.

| Suite | Tests | Planted bugs noticed | Faults caught by a check | Fault-check time |
|---|---|---|---|---|
| weak | 2 | 1 of 20 | 0 of 16 | 82 s |
| shop | 3 | 9 of 20 | 12 of 23 | 168 s |
| thorough | 5 | 17 of 20 | 23 of 36 | 183 s |

Run again on the final code with the machine overloaded (load 60): shop 12 of 23, thorough 22 of 35 (one fault no
longer took effect), same planted bugs. weak couldn't start its web server in time and was reported as untrusted, not
scored; repeated alone it gave 0 of 16. benchmark.json holds this second run. Times were 2-4 times longer.

The order agrees. That is all it shows: three suites, one small app, and the bugs, suites and tool were written by the
same author. `thorough` was written knowing the bug list. A fair test needs somebody else's app and tests.
Not measured: AI repair accuracy and tokens.

Audit on a real suite (587 tests, read only): the first version gave 72 findings; all 5 sampled weak-check findings were
false alarms. After tightening: 11 findings, 5 sampled, all accurate.

## Real app, 2026-11-25
Three e2e tests of a private web app, against the real app (Playwright 1.63, at most 10
faults each): 4 of 6, 3 of 6 and 8 of 9 caught; 9 of 30 faults not reached, 69 more not tried, 7 min 49 s in all. No bugs
were planted, so this shows that it runs, not that the score predicts anything.
