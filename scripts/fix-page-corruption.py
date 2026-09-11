#!/usr/bin/env python3
"""Repair the 3 syntax-corrupted useState lines in src/app/rizz/page.tsx
left by the parallel Task 64 write (const [m / [h lost its bracket+letter).
Atomic: write temp file, os.replace over the target. Verifies after."""

import os, sys, hashlib

TARGET = "/home/z/my-project/src/app/rizz/page.tsx"

FIXES = {
    '  const ode, setMode] = useState<Mode>("reply");':
        '  const [mode, setMode] = useState<Mode>("reply");',
    '  const istory, setHistory] = useState<HistEntry[]>([]);':
        '  const [history, setHistory] = useState<HistEntry[]>([]);',
    '  const istOpen, setHistOpen] = useState(false);':
        '  const [histOpen, setHistOpen] = useState(false);',
}

def main():
    with open(TARGET, "r", encoding="utf-8") as f:
        src = f.read()

    before = hashlib.md5(src.encode()).hexdigest()
    n_fixed = 0
    for bad, good in FIXES.items():
        if bad in src:
            src = src.replace(bad, good, 1)
            n_fixed += 1
        elif good in src:
            print(f"already fixed: {good.strip()}")
        else:
            print(f"WARN: neither variant found for: {bad.strip()}")

    tmp = TARGET + ".fix"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(src)
    os.replace(tmp, TARGET)

    with open(TARGET, "r", encoding="utf-8") as f:
        check = f.read()
    after = hashlib.md5(check.encode()).hexdigest()

    leftover = [b for b in FIXES if b in check]
    print(f"before={before} after={after} fixed={n_fixed} leftover={len(leftover)}")
    if leftover or n_fixed == 0:
        sys.exit(1)
    print("REPAIR OK")

if __name__ == "__main__":
    main()
