# Existing library helper integration

The web reader's native mode first connects to the existing library service on
`http://127.0.0.1:38479`, then tries the optional standalone reader host on port 18766.
The browser mode continues to synthesize in a browser worker without either service.

For a PC that already runs the epubtotxt library helper with Supertonic 3 installed,
back up its `supertonic3/bridge.html` and `supertonic3/bridge.mjs`, then replace those
two files with the corresponding files in `library-bridge/`. The existing Python
service reads these static files on demand; it does not need a restart. This does
not install a startup task, copy any books, or change the library database.

The original `reader-tts` protocol remains available to the original local library.
The additional `ebook-speech` protocol accepts native speech jobs from the exact
public origin `https://narpheus-cpu.github.io` and existing local reader origins.
It exposes no library records, tokens, preferences API or export API. Native audio
requests stay inside the PC. Browser permission to reach localhost may still be
required by the browser. The optional port 18766 host remains the MP3 endpoint.

These files assume the existing helper already has its native synthesis endpoint,
Node runtime, ONNX model and voice files. They do not turn a browser-downloaded model
into an installed native runtime. PCs without that service need the separate PC
helper, or can use the independent browser mode.
