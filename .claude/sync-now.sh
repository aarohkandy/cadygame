#!/bin/bash
# One-shot mirror of the working tree to homebase. Run before any remote command.
rsync -az --delete \
  --exclude node_modules --exclude '.next*' --exclude .eval --exclude dist-app \
  --exclude '.git/index.lock' --exclude 'docs/design/screens' \
  -e "ssh -i $HOME/.ssh/homebase_ed25519 -o ControlMaster=auto -o ControlPath=/tmp/tl-sync-%r@%h:%p -o ControlPersist=300" \
  /Users/aaroh/cadybot/wrestling_arena/ azureuser@100.108.213.121:~/work/torque-limit/
