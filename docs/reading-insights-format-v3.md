# 독서정보 schema_version 3: 뷰어 파일 구조

이 명세는 새 독서정보를 생성할 때 쓰는 데이터 구조다. 기존 v2 파일은 이전 책을 읽기 위한 호환 모드로 유지한다.

## 통합 TXT

소설 원문을 그대로 두고 맨 뒤에 빈 줄 두 개와 메타데이터를 덧붙인다.

```text
(소설 원문)

<<<READER_INSIGHTS_V3_BEGIN>>>
{"schema_version":3,"records":[...]}
<<<READER_INSIGHTS_V3_END>>>
```

JSON 블록은 원문이 아니며, 최종 TXT의 원문 부분은 문자·바이트 기준으로 변형하지 않는다.

## 네 범주

- `plot`: 현재까지 줄거리 — 독서정보 창 첫 화면, 읽은 지점에서 공개된 최신 누적본 하나만 표시
- `relation`: 인물 관계
- `character`: 인물별 분석
- `clue`: 핵심 단서

새 v3에서 `event`는 허용하지 않는다. v2의 `event`는 호환 표시에서만 기존 사건 연표로 남는다.

## 공통 필드

`id`, `category`, `subject`, `title`, `scene_id`, `reveal`, `entities`, `aliases`, `related_ids`, `importance`.

`reveal`은 `{"quote":"실제 원문에 있는 20~500자 구절","occurrence":1}`처럼 기입한다. `entities`의 각 항목에는 `id`, `name`, `type`, `aliases`가 필요하다. `related_ids`는 기존에 공개된 레코드만 가리킬 수 있다.

## 현재까지 줄거리

`plot` 레코드는 반드시 `subject="현재까지 줄거리"`, `bullets` 배열, `previous_plot_id`를 갖는다. 첫 버전의 `previous_plot_id`는 `null`, 이후에는 직전 plot 레코드의 ID다.

각 `bullets` 항목은 `{ "text": "완결된 누적 줄거리 문장", "confidence": "fact", "evidence": [{"quote": "원문 구절", "occurrence": 1}] }` 형태다. 이 예시의 인용문은 가상 문자열이므로 실제 데이터 작성 시 반드시 원문의 정확한 구절로 대체해야 한다.

각 버전은 소설의 처음부터 해당 공개 지점까지 중요한 사건과 인과관계를 독립적으로 포함한다. 이전 버전은 덮어쓰지 않고 변경 이력으로 유지한다. 줄거리 항목 번호는 뷰어가 자동 부여하며 텍스트에 미리 붙이지 않는다. plot에는 `replaces`를 쓰지 않는다.

## 일반 기록

`relation`, `character`, `clue` 레코드는 공통 필드 외에 `body`, `confidence`, `evidence`(원문 문자열), `replaces`(이전 판단 대체 시에만 ID, 그 외 `null`)를 갖는다.

## 파일 생성 시 반드시 사용할 표식

새 독서정보 파일은 JSON의 `schema_version`을 **3**으로 하고, 통합 TXT의 시작·끝을 각각 `<<<READER_INSIGHTS_V3_BEGIN>>>` / `<<<READER_INSIGHTS_V3_END>>>`로 일치시켜야 한다.

과거 일부 생성기에서 잘못 출력한 `<<<READER_INSIGHTS_V2_START>>>` + `schema_version: 2` + `plot` 혼합 파일은 v1.37 이상에서 **원문·공개 위치·근거 전부가 검증되는 경우에만** v3로 변환하여 연다. 이것은 이전 오류를 위한 호환 처리이며, 새 파일에 사용해서는 안 된다.

일반 기록에 서로 떨어진 원문 근거가 여러 개일 경우 `evidence`에는 모든 원문 구절을 포함하는 원본 연속 문자열을 보존하고, 선택적으로 `evidence_passages: [{"quote":"각 원문 구절","occurrence":1}]`에 해당 구절을 따로 기록할 수 있다. 뷰어는 각각의 구절을 표시 단계에서 개별 요약하되 원본 데이터는 변경하지 않는다.

## 근거·스포일러

원문 근거는 저장 시 완전하게 보존한다. 뷰어는 근거가 6문장 이하일 때 전문을, 7문장 이상일 때 앞 3문장과 뒤 3문장 사이에 `(중략)`을 넣어 표시한다. plot은 각 bullet의 evidence 배열마다 적용한다.

새 정보와 plot 버전의 공개 시점은 실제 원문 구절의 출현 위치로 판정한다. 현재 지점 이후의 근거·이름·별칭·관계·줄거리는 검색 및 화면에 공개하지 않는다. 의미 차원의 인과관계와 스포일러 검사는 기계적 구조 검증만으로 보장되지 않으므로 소설을 구간별로 읽으며 원문에 대조해야 한다.
