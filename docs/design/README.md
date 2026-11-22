# Design notes

Short design docs for open indexer issues. Each one says what the code does today, what to change,
and how to test it. Use them as a starting point, not a contract. If the implementation ends up
different, update the doc in the same PR.

| Issue | Doc | Touches |
| --- | --- | --- |
| #248 | [Ledger close time as a real column](./248-ledger-closed-at-column.md) | db schema + migration, indexer |
| #249 | [Skip transfers from failed contract calls](./249-skip-failed-call-transfers.md) | indexer, webhooks doc |
| #255 | [One indexer per network (advisory lock)](./255-indexer-advisory-lock.md) | indexer loop |
| #259 | [Typed ScVal decoding](./259-typed-scval-decoding.md) | decode package, indexer, api spec, SDK |

Suggested order: **#248, then #249, then #255, then #259**. #248 fixes an inconsistency already on `main`
(see that doc). #249 is small and changes the same insert block. #255 wraps the whole batch, so it
goes in more cleanly once that block has settled. #259 is the largest change and doesn't depend on the
others.
