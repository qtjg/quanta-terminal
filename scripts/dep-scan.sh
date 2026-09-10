#!/bin/bash
# Scan remaining src/ for actual imports of each dependency; print UNUSED deps.
cd /home/z/my-project
DEPS=$(node -e "const p=require('./package.json'); console.log(Object.keys(p.dependencies||{}).join('\n')); console.log(Object.keys(p.devDependencies||{}).join('\n'))")
for dep in $DEPS; do
  # match: from "<dep>" | from "<dep>/..." | import "<dep>" | require("<dep>")
  hits=$(grep -rE "from [\"']${dep}(/|[\"'])|import [\"']${dep}([\"']/.*)?[\"']|require\([\"']${dep}" src/ scripts/ 2>/dev/null | wc -l)
  if [ "$hits" -eq 0 ]; then
    echo "UNUSED: $dep"
  fi
done
