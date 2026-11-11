-- Run on a fresh isolated database, after the API has created its schema.
\set ON_ERROR_STOP on
BEGIN;
LOCK TABLE tickets IN SHARE ROW EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM tickets) THEN RAISE EXCEPTION 'Expected an empty test database'; END IF;
END $$;
CREATE TEMP TABLE archive ON COMMIT DROP AS
SELECT i, md5('history-ticket-'||i)::uuid id,
  now() - interval '181 days' + i * interval '43.2 seconds' AS opened,
  i%5=0 AS human,
  CASE i%2 WHEN 0 THEN 'InfinitePay' ELSE 'JIM' END brand,
  (ARRAY['Normal','Alta','Urgente'])[1+i%3] priority
FROM generate_series(1,360000) i;
INSERT INTO tickets(id,client,brand,channel,category,priority,phase,status,queue,team,owner,summary,motive,revision,version,updated)
SELECT id,'archive-'||i,brand,(ARRAY['Chat','WhatsApp','E-mail'])[1+i%3],'Pix',priority,
  CASE WHEN human THEN 'Humano' ELSE 'IA' END,'Encerrado',
  CASE WHEN NOT human THEN 'auto' WHEN brand='JIM' THEN 'us' ELSE 'br' END,'Atendimento',
  CASE WHEN human THEN 'analista-'||(i%16) END,CASE WHEN human THEN 'Cliente solicitou apoio no Pix.' ELSE '' END,
  CASE WHEN human THEN 'Solicitação do cliente' ELSE '' END,2,1,opened + interval '5 minutes' FROM archive;
INSERT INTO messages(ticket,author,body,created)
SELECT id,(ARRAY['Cliente','IA','Cliente','IA','Analista'])[k],
  (ARRAY['Dúvida sobre Pix','Como posso ajudar com o Pix?',CASE WHEN human THEN 'Quero falar com humano sobre Pix' ELSE 'Obrigado, resolvido' END,
  CASE WHEN human THEN 'Vou encaminhar seu caso.' ELSE 'Atendimento encerrado.' END,'Conferi o Pix fictício.'])[k],
  opened+k*interval '1 minute' FROM archive CROSS JOIN generate_series(1,5) k WHERE human OR k<5;
INSERT INTO audit(ticket,kind,detail,created)
SELECT id, CASE k WHEN 1 THEN 'Triagem' WHEN 2 THEN 'Transferência humana' WHEN 3 THEN 'Caso assumido' ELSE 'Encerramento' END,
  jsonb_build_object('version',1,'synthetic',true),opened+k*interval '1 minute'
FROM archive CROSS JOIN generate_series(1,4) k WHERE human OR k IN (1,4);
INSERT INTO outbox(id,ticket,payload,tries,state,due)
SELECT md5('archive-event-'||i||'-'||k)::uuid,id,jsonb_build_object('ticket',id,'revision',k,'synthetic',true),1,'sent',opened+k*interval '1 minute'
FROM archive CROSS JOIN generate_series(1,2) k;
INSERT INTO inbox(id,created) SELECT id,due+interval '1 second' FROM outbox;
COMMIT;
VACUUM ANALYZE tickets;
VACUUM ANALYZE messages;
VACUUM ANALYZE audit;
VACUUM ANALYZE outbox;
VACUUM ANALYZE inbox;
