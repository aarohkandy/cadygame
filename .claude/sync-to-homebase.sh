#!/bin/bash
# Mirrors the working tree to homebase so the remote dev server serves current code.
# Source of truth is the laptop; node_modules/.next/.eval stay local to each side.
SRC=/Users/aaroh/cadybot/wrestling_arena/
# No leading ~ : bash expands a tilde after the colon in an assignment, which silently made this
# rsync to a local /Users/<me>/work/torque-limit instead of the server. rsync resolves a relative
# remote path against the login home directory, which is what we want anyway.
DST=azureuser@100.108.213.121:work/torque-limit/
KEY=~/.ssh/homebase_ed25519
while true; do
  rsync -az --delete \
    --exclude node_modules --exclude '.next*' --exclude .eval --exclude dist-app \
    --exclude '.git/index.lock' --exclude 'docs/design/screens' \
    -e "ssh -i $KEY -o ControlMaster=auto -o ControlPath=/tmp/tl-sync-%r@%h:%p -o ControlPersist=300" \
    "$SRC" "$DST" >/dev/null 2>>/tmp/tl-sync.err
  sleep 3
done
