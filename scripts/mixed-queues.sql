-- Reproduce the analyst list ordering and limit for each brand and team.
WITH ranked AS (
  SELECT brand, team, status,
    row_number() OVER (
      PARTITION BY brand, team
      ORDER BY CASE priority WHEN 'Urgente' THEN 1 WHEN 'Alta' THEN 2 ELSE 3 END, updated
    ) AS position
  FROM tickets WHERE phase='Humano'
)
SELECT brand, team,
  count(*) FILTER (WHERE status='Aguardando analista') AS waiting,
  count(*) FILTER (WHERE position<=250 AND status='Aguardando analista') AS waiting_visible,
  count(*) FILTER (WHERE position<=250 AND status='Encerrado') AS closed_visible
FROM ranked GROUP BY brand, team ORDER BY brand, team;

WITH events AS (
  SELECT ticket,
    count(*) FILTER (WHERE kind='Transferência humana') AS handoffs,
    count(*) FILTER (WHERE kind='Caso assumido') AS claims,
    count(*) FILTER (WHERE kind='Encerramento') AS closures
  FROM audit WHERE ticket IS NOT NULL GROUP BY ticket
)
SELECT t.brand, count(*) AS human_cases,
  count(*) FILTER (WHERE handoffs=1 AND summary<>'' AND motive<>'' AND
    queue=CASE brand WHEN 'JIM' THEN 'us' WHEN 'InfinitePay' THEN 'br' END
  ) AS audited_with_context_and_expected_queue,
  count(*) FILTER (WHERE status='Encerrado' AND claims=1 AND closures=1) AS audited_closures,
  count(DISTINCT owner) AS distinct_owners
FROM tickets t LEFT JOIN events e ON e.ticket=t.id
WHERE t.phase='Humano' GROUP BY t.brand ORDER BY t.brand;
