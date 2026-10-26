from pathlib import Path
repo=Path(__file__).resolve().parents[1]
code=(repo/'timeline-core.js').read_text(encoding='utf-8')+'\n'+(repo/'timeline-ui.js').read_text(encoding='utf-8')+'\n'
css=(repo/'timeline.css').read_text(encoding='utf-8').strip()+'\n'
for file in [repo/'index.html',repo/'android/app/src/main/assets/index.html']:
 s=file.read_text(encoding='utf-8');a=s.index('/* Comparative timeline parsing.');b=s.index('/* Inline notes are stored',a);s=s[:a]+code+s[b:]
 a=s.index('.page-inner .reader-year{');b=s.index('</style>',a);s=s[:a]+css+s[b:]
 file.write_text(s,encoding='utf-8',newline='\n')
