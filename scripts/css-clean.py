#!/usr/bin/env python3
"""Remove dead Tokyo-era CSS blocks from globals.css."""
import re

path = "/home/z/my-project/src/app/globals.css"
src = open(path).read()

# 1) Lenis smooth-scrolling block (whole section, up to next top-level comment)
src = re.sub(
    r"/\* ---- Lenis smooth scrolling ---- \*/.*?(?=/\* ---- Leaflet map pins)",
    "",
    src,
    flags=re.S,
)

# 2) Leaflet pins + leaflet chrome block (up to "Prevent decorative" comment)
src = re.sub(
    r"/\* ---- Leaflet map pins \(Visit Tokyo\) ---- \*/.*?(?=/\* Prevent decorative)",
    "",
    src,
    flags=re.S,
)

# 3) Lenis mention in pull-to-refresh comment
src = src.replace(
    "/* Keep Android Chrome's pull-to-refresh from fighting Lenis on long pages */",
    "/* Stop Android Chrome pull-to-refresh from fighting long scrollbacks */",
)

# 4) Print styles block (packing checklist) — up to the css bump marker
src = re.sub(
    r"/\* -+ Print styles.*?(?=/\* css bump)",
    "",
    src,
    flags=re.S,
)

# collapse any 3+ consecutive blank lines left behind
src = re.sub(r"\n{3,}", "\n\n", src)

open(path, "w").write(src)

left = [w for w in ["Lenis", "lenis", "vt-pin", "leaflet", "Leaflet", "VISIT TOKYO", "@media print", "data-lang"] if w in src]
print("remaining offenders:", left if left else "NONE")
print("lines:", src.count("\n") + 1)
