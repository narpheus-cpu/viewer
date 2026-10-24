Android 앱 소스입니다. Android SDK 36, JDK 17 이상, 호환 Gradle 환경에서 assembleDebug로 빌드합니다. 공개 소스 빌드에는 개발자 본인의 기본 디버그 서명을 사용합니다. 배포된 업데이트 APK의 개인 서명 키는 포함하지 않습니다. 기존 설치에 덮어쓸 APK는 제공된 업데이트 파일을 사용하세요.

선택 메뉴 계약 검사는 python tests/selection_menu.py로 실행합니다. JDK가 필요하며, 모의 Android 콜백에서 메뉴·좌표·선택 보존 순서를 검사합니다. 실제 기기 터치 검사를 대신하지 않습니다.
