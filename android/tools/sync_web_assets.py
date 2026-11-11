#!/usr/bin/env python3
"""Stage the latest GitHub Pages reader into the offline Android WebView assets.

This intentionally keeps Android's chooser-first launch: an old cached 1M-character
book must never be automatically opened on app start.
"""
from pathlib import Path
import re
import shutil

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / "android/app/src/main/assets"
WEB = ROOT / "index.html"
DEPENDENCIES = (
    "reader-insights.css",
    "reader-insights-data.js",
    "reader-insights.js",
    "reader-insights-nav.js",
)

def stage():
    source = WEB.read_text(encoding="utf-8")
    for name in DEPENDENCIES:
        if name not in source:
            raise RuntimeError(f"Latest Web index missing dependency: {name}")
    if "<head>" not in source or "</head>" not in source:
        raise RuntimeError("Cannot find reader HTML head")

    # The current Web HTML already embeds readerState and readerReady inline.
    # Reinjecting reader-core.js would redeclare its top-level const and break startup.
    # Only the native checkpoint bridge must be loaded as a separate local script.
    source = source.replace("<head>", "<head>\n"
        '<script src="./android.js"></script>', 1)

    # The Web page eagerly reopens a last-read book. The Android UI deliberately
    # shows a chooser and defers large-book parsing until the user selects one.
    marker = "const syncReading=loadReadingSessionSync();"
    start = source.rfind(marker)
    end = source.find("\n</script>", start)
    if start < 0 or end < start or source.count(marker) != 1:
        raise RuntimeError("HTML startup changed: cannot preserve chooser-first behavior")
    # Make sure only the known final setup tail is replaced, never an inner script.
    prefix = source[max(0, start-160):start]
    if "setupReaderTools();" not in prefix:
        raise RuntimeError("Cannot safely replace application startup")
    source = source[:start] + (
        "// Android: no automatic reopening of a large cached book.\n"
        "readerState.initializing=false;\n"
        "restoreInProgress=false;\n"
        "readerSetLoading(false);\n"
        "resolveReaderReady();\n"
        "void Promise.resolve().then(()=>showRecentHistory()).catch(error=>setStatus(error.message,true));"
    ) + source[end:]
    if marker in source:
        raise RuntimeError("Unexpected eager book-opening logic remains")
    for name in DEPENDENCIES:
        shutil.copy2(ROOT / name, ASSETS / name)
    (ASSETS / "index.html").write_text(source, encoding="utf-8", newline="\n")
    print(f"Staged Android HTML ({len(source):,} chars) and {len(DEPENDENCIES)} reader-insights assets")
    return source

if __name__ == "__main__":
    stage()
