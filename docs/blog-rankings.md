# Blog badges

Trending and Most Read are independent and may both appear on one blog.

## Most Read (launched 4 November 2026)

- Cumulative qualifying reads received since midnight on 4 November 2026 in Asia/Kolkata (`2026-11-03T18:30:00Z`). There is no historical backfill, daily reset, rolling window, or decay.
- All published blogs qualify regardless of publication age. Deleted and future-dated blogs are excluded.
- A read requires 30 seconds of visible time on the article page. Time in a hidden tab does not count. Clicks, impressions, shares, bookmarks and brief visits do not count as reads.
- A random browser identifier is stored locally; only its SHA-256 hash is stored with a read. A unique database index counts at most one read per browser, article and calendar day in Asia/Kolkata, including retries and concurrent tabs. This measures browser reads, not verified unique people; clearing storage or using another browser creates a different identity.
- The four articles with the most qualifying reads receive the badge, with at least one read required. Ties use the most recent qualifying read, then article ID ascending.
- `GET /api/most-read` returns the selected articles with `readCount` and launch/refresh metadata. Clients refresh every minute and after recording a new read. `POST /api/most-read/reads` validates and records a read under the existing event rate limiter.
- Counting begins when the new frontend and backend are deployed. Nothing reconstructs reads that happened before deployment, even on launch day.

## Trending

The existing top-four ranking remains unchanged: a 60-day publication window, engagement-based sampling, freshness/click/category adjustments, and five-minute ranking epochs. Older blogs can receive Most Read while remaining ineligible for Trending.
