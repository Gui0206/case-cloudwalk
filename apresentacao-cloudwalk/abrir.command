#!/bin/zsh
# Servidor local independente da aplicação de demonstração.
cd -- "${0:A:h}" || exit 1
if lsof -nP -iTCP:4399 -sTCP:LISTEN >/dev/null 2>&1; then
  print 'A porta 4399 já está em uso. Se o deck já estiver aberto, use a aba existente.'
  open 'http://127.0.0.1:4399/'
  exit 0
fi
python3 -m http.server 4399 --bind 127.0.0.1 &
deck_server_pid=$!
trap 'kill "$deck_server_pid" 2>/dev/null' EXIT INT TERM
sleep 1
open 'http://127.0.0.1:4399/'
print 'Mantenha esta janela aberta durante a apresentação. Ctrl+C encerra o servidor.'
wait "$deck_server_pid"
