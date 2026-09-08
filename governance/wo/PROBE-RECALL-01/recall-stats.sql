-- Execute with sqlite3 -readonly; no conversation text is emitted.
SELECT 'total', count(*) FROM history WHERE event_type='conversation';
SELECT date(ts), count(*) FROM history WHERE event_type='conversation'
  AND julianday(ts)>=julianday('now','-30 days') GROUP BY date(ts) ORDER BY date(ts);
WITH lengths AS (
  SELECT 'user' AS side, length(json_extract(content,'$.user')) AS n FROM history
    WHERE event_type='conversation' AND json_valid(content)
  UNION ALL
  SELECT 'reply', length(json_extract(content,'$.reply')) FROM history
    WHERE event_type='conversation' AND json_valid(content)
), ranked AS (
  SELECT side,n,row_number() OVER(PARTITION BY side ORDER BY n) AS r,
    count(*) OVER(PARTITION BY side) AS total FROM lengths WHERE n IS NOT NULL
)
SELECT side, avg(CASE WHEN r IN ((total+1)/2,(total+2)/2) THEN n END) AS median,
  min(CASE WHEN r>=((9*total+9)/10) THEN n END) AS p90 FROM ranked GROUP BY side;
WITH ordered AS (
  SELECT julianday(ts) AS t,lag(julianday(ts)) OVER(ORDER BY julianday(ts),id) AS prev
  FROM history WHERE event_type='conversation' AND julianday(ts) IS NOT NULL
), ranked AS (
  SELECT (t-prev)*1440 AS minutes,row_number() OVER(ORDER BY t-prev) AS r,
    count(*) OVER() AS total FROM ordered WHERE prev IS NOT NULL
)
SELECT 'interval_minutes',avg(minutes) FROM ranked WHERE r IN ((total+1)/2,(total+2)/2);
SELECT 'invalid_json',count(*) FROM history WHERE event_type='conversation' AND NOT json_valid(content);
