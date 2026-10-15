#!/bin/bash
# Each pass embeds up to RAG_MAX_EMBED chunks then exits, releasing all leaked
# native memory. Hash-skip makes restarts free, so this converges. Exit 75 = more to do.
export HOME=/root PATH=/usr/local/bin:/usr/bin:/bin
cd /root/projects/LSGD-ops-dash
for i in $(seq 1 200); do
  RAG_MAX_EMBED=${RAG_MAX_EMBED:-2000} node rag/indexer.mjs; rc=$?
  echo "[loop] pass $i exit=$rc $(date -u +%H:%M:%S)"
  [ "$rc" = "75" ] || break
done
echo "[loop] COMPLETE"
