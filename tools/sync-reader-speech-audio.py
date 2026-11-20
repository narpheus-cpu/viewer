"""Keep the reader's playback core inline, including when an older HTML is cached."""
from pathlib import Path

root = Path(__file__).resolve().parents[1]
core = (root / "reader-speech-audio.js").read_text(encoding="utf-8").strip()
target = root / "reader-speech.js"
source = target.read_text(encoding="utf-8")
start = "/* BEGIN bundled reader-speech-audio.js */\n"
end = "/* END bundled reader-speech-audio.js */\n"
if source.startswith(start):
    source = source.split(end, 1)[1].lstrip("\n")
target.write_text(start + core + "\n" + end + "\n" + source, encoding="utf-8", newline="\n")
