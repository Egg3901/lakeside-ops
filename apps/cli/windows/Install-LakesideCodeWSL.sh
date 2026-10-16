#!/usr/bin/env bash
set -eu
if [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh"; fi
command -v node >/dev/null || { echo 'Install Node.js 22.12 or later inside this WSL distro, then rerun.' >&2; exit 1; }
node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22 || a===22 && b>=12 ? 0 : 1)'
# A private prefix avoids requiring sudo or replacing other global CLIs.
prefix="$HOME/.local/share/lakeside-code"
npm install --prefix "$prefix" "$1" --no-audit --no-fund
"$prefix/node_modules/.bin/lakeside" code doctor
mkdir -p "$HOME/.local/bin"
for command in lakeside lakeside-code; do
  destination="$HOME/.local/bin/$command"
  target="$prefix/node_modules/.bin/$command"
  if [ -e "$destination" ] || [ -L "$destination" ]; then
    if [ "$(readlink "$destination" || true)" != "$target" ]; then
      echo "Preserving existing $destination. Use $target directly." >&2
      continue
    fi
  else
    ln -s "$target" "$destination"
  fi
done
printf '\nInstalled. In Ubuntu, run: ~/.local/bin/lakeside code ~/projects/your-project\n'
if [ "$2" = preview ]; then exec "$prefix/node_modules/.bin/lakeside" code --preview; fi
