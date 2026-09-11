#!/usr/bin/env python3
"""Rebuild the RizzReply PC extension zip (flat layout, files at root)."""
import os
import zipfile

SRC = "/home/z/my-project/extension"
OUT = "/home/z/my-project/public/rizz-extension-v0.12.0.zip"
FILES = ["background.js", "content.css", "manifest.json", "README.md", "content.js", "icon.png"]

with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
    for name in FILES:
        path = os.path.join(SRC, name)
        z.write(path, name)

size = os.path.getsize(OUT)
with zipfile.ZipFile(OUT) as z:
    bad = z.testzip()
    names = z.namelist()
print(f"built {OUT} ({size} bytes), testzip bad={bad}, files={len(names)}")
assert bad is None and len(names) == 6

# sanity: manifest inside zip must be 0.12.0
import json, io
with zipfile.ZipFile(OUT) as z:
    m = json.loads(z.read("manifest.json"))
assert m["version"] == "0.12.0", m["version"]
print("zip manifest version:", m["version"], "✓")
