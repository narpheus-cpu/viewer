#!/usr/bin/env python3
"""Static Android asset / native bridge gate, run after sync_web_assets.py."""
from pathlib import Path
import re
import sys

repo=Path(__file__).resolve().parents[2]
assets=repo/"android/app/src/main/assets"
main=(repo/"android/app/src/main/java/com/seosol/ebookviewer/recent/MainActivity.java").read_text(encoding="utf-8")
menu=(repo/"android/app/src/main/java/com/seosol/ebookviewer/recent/ReaderWebView.java").read_text(encoding="utf-8")
index=(assets/"index.html").read_text(encoding="utf-8")
host=(assets/"android.js").read_text(encoding="utf-8")
orig=(repo/"index.html").read_text(encoding="utf-8")
checks=0

def check(test,reason):
    global checks
    if not test:raise AssertionError(reason)
    checks+=1

for name in ("reader-insights.css","reader-insights-data.js","reader-insights.js","reader-insights-nav.js"):
    check((assets/name).is_file(),f"Missing APK asset: {name}")
    check((assets/name).read_bytes()==(repo/name).read_bytes(),f"Outdated APK resource: {name}")
    check(name in index,f"APK HTML does not reference {name}")
    check('"/assets/'+name+'"' in main,f"APK request handler does not whitelist {name}")
check('path.endsWith(".css") ? "text/css"' in main,"Missing CSS MIME type")
check('blockNetworkLoads(true)' in main,"Network requests unexpectedly enabled")
check('showRecentHistory()' in index,"Android startup must display the file chooser")
check('const syncReading=loadReadingSessionSync();' not in index,"Old automatic book reopening remains")
check('readerState.initializing=false;' in index,"Reader initialization never finishes")
check('resolveReaderReady();' in index,"Reader readiness promise not settled")
check('<script src="./android.js"></script>' in index,"Android checkpoint bridge missing")
check('<script src="./reader-core.js"></script>' in index,"Android reading core missing")
check('window.readerInsights?.isOpen?.()' in host,"Native back button does not handle insights overlay")
check('window.readerInsights?.cancelCorrection?.()' in host,"Back does not cancel read position correction")
for title in ("ChatGPT연결","읽은 지점 지정","독서정보 보기"):
    check(title in menu,"Native selection missing "+title)
check('window.readerInsights.selectToRead()' in menu,"Native selected-word cutoff lacks JS bridge")
check('readerInsights.openForSelection(' in menu,"Native selected-word search lacks JS bridge")
check('readerInsights' in index,"Android HTML does not contain insight functionality")
check('<<<READER_INSIGHTS_V2_BEGIN>>>' not in index,"File metadata marker must not appear in reader HTML source")
check(len(index)>len(orig)-30000,"APK HTML appears truncated")
check(index.count('</script>')>=orig.count('</script>'),"Missing reader scripts")
check('window.readerInsights?.observe()' in index,"Missing page-position progress hooks")
print(f"{checks} offline APK assets, bridge, startup and cutoff checks passed.")
