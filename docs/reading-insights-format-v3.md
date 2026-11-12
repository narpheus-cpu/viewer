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

각 `bullets` 항목은 `{ "text": "첫 만남: 인물, 상대의 무례한 언행으로 충격을 받음.", "confidence": "fact" }` 형태다. **정식 v3의 줄거리 항목에는 `evidence` 및 `evidence_status`를 생성하지 않는다.**

각 버전은 소설의 처음부터 해당 공개 지점까지 중요한 사건과 인과관계를 독립적으로 포함한다. 이전 버전은 덮어쓰지 않고 변경 이력으로 유지한다. 줄거리 항목 번호는 뷰어가 자동 부여하며 텍스트에 미리 붙이지 않는다. plot에는 `replaces`를 쓰지 않는다.

## 압축·재구성 줄거리 작성 방식

각 `plot.bullets[].text`에는 완결된 서술형 문장 대신 `핵심어: 사건·원인·결과·변화` 형태의 간결한 개조식을 사용할 수 있다. 뷰어는 표시할 때 항목 번호를 자동으로 붙인다.

새로운 줄거리 버전은 **직전 버전에 항목을 덧붙이는 것이 아니라**, 독자가 해당 시점까지 읽은 전체 이야기를 압축·통합·재해석한 독립 보고서다. 따라서 이전 버전보다 항목 수가 줄어들어도 정상이다. 과거 버전은 삭제·덮어쓰기 없이 `previous_plot_id`로 연결한다.

줄거리에는 원문 근거를 인용하지 않는다. 다만 줄거리 내용 자체는 해당 독서 지점까지의 실제 원문에 기반해야 하며, 각 줄거리 **버전**의 `reveal.quote`와 `reveal.occurrence`는 공개 위치를 확인하는 기술적 표식이므로 유지해야 한다.

### 근거가 누락된 옛 생성물의 예외적 표시

과거 일부 생성 파일은 `V2_START`, `schema_version:2`, `plot`을 혼합하고, `source_metadata.plot_style`에 `compressed_reconstructed_full_report_no_evidence`를 명시했으며, `plot.bullets[].evidence`가 없다. v1.38부터 이 **식별 가능한 중간 형식에 한해** 저장·표시가 가능하다.

v1.40부터는 이러한 혼합형도 정식 v3 줄거리와 마찬가지로 근거 없는 압축형 보고서로 보여 준다. `evidence_status`를 줄거리 카드에 표시하지 않고, 항목별 인용문을 임의 생성하지 않는다.

## 일반 기록

`relation`, `character`, `clue` 레코드는 공통 필드 외에 `body`, `confidence`, `evidence`(원문 문자열), `replaces`(이전 판단 대체 시에만 ID, 그 외 `null`)를 갖는다.

## 파일 생성 시 반드시 사용할 표식

새 독서정보 파일은 JSON의 `schema_version`을 **3**으로 하고, 통합 TXT의 시작·끝을 각각 `<<<READER_INSIGHTS_V3_BEGIN>>>` / `<<<READER_INSIGHTS_V3_END>>>`로 일치시켜야 한다.

과거 생성기의 `V2_START` + `schema_version: 2` + `plot` 혼합 파일은 호환 목적으로 인식한다. 신형 v3 줄거리에 항목별 원문 인용이 없는 것은 정상이다. 과거 v3의 줄거리 항목에 인용 데이터가 있더라도 뷰어는 이를 검증한 뒤 줄거리 화면에서는 표시하지 않는다. 새 파일은 반드시 V3 표식을 사용한다.

일반 기록에 서로 떨어진 원문 근거가 여러 개일 경우 `evidence`에는 모든 원문 구절을 포함하는 원본 연속 문자열을 보존하고, 선택적으로 `evidence_passages: [{"quote":"각 원문 구절","occurrence":1}]`에 해당 구절을 따로 기록할 수 있다. 뷰어는 각각의 구절을 표시 단계에서 개별 요약하되 원본 데이터는 변경하지 않는다.

## 근거·스포일러

`relation`, `character`, `clue`의 원문 근거는 저장 시 완전하게 보존한다. 이 세 범주의 근거가 6문장 이하일 때는 전문을, 7문장 이상일 때는 앞 3문장과 뒤 3문장 사이에 `(중략)`을 넣어 보여 준다. **`plot`에서는 원문 근거를 생성하거나 표시하지 않는다.**

새 기록과 plot 버전의 공개 위치는 실제 원문 구절의 `reveal` 출현 위치로 확인한다. 읽은 위치 이후의 줄거리와 정보는 공개하지 않는다. 줄거리 내용 자체의 의미적 타당성은 기계적인 위치 검증만으로 증명할 수 없으므로 생성 과정에서 해당 시점까지의 원문을 직접 확인한다.
