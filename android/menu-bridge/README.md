> 이전 별도 연결 앱입니다. 모바일 웹은 기존 전자책뷰어의 계정을 공유하는
> [v1.26 업데이트](../../downloads/EbookViewer_v1.26.apk)를 사용하세요.

# Android browser text-selection bridge

This separate package (`com.seosol.ebookviewer.chatgptmenu`) adds **ChatGPT연결** to
Android browsers that expose ACTION_PROCESS_TEXT handlers. It has no launcher icon;
select text in the browser to open it. The item may be in the toolbar overflow menu.

It uses the same native OAuth client and bundled answer-first UI as the reader.
The selected text stays in memory; it never becomes a book, URL parameter, or automatic
question. Close finishes the activity and returns to the browser. Preferences remain
in the companion app, separately from the original reader and web origin.

Build with JDK 17 and Android SDK platform/build-tools 36:

```sh
python android/menu-bridge/build.py --sdk /path/to/sdk --jdk /path/to/jdk17 --keystore /private/menu-signing.jks
```

Keep the generated signing keystore outside Git for future updates. The script uses
`MENU_KEY_PASSWORD` (default `android`). The APK is written under `downloads/`.
The companion manifest has no launcher activity. The original reader manifest also
registers the same selection alias; use only one provider to avoid duplicate entries.

Validation: compile, D8, packaged manifest/asset checks, APK signature and alignment,
`tests/process-text.cjs`, existing ChatGPT UI tests and native selection callback tests.
Browser/OEM menu availability and taps still require a real Android device.
