# Manyfast REA 정적 분석 기록

조사일: 2026-10-16. 범위: 사용자가 로그인한 브라우저에서 실제 로드가 확인된 공개 JavaScript 파일. 로그인 쿠키·토큰·계정 데이터 없이 공개 URL만 내려받았고, 내려받은 코드는 실행하지 않았다. 원본 서비스의 생성·저장·내보내기 API는 호출하지 않았다.

## 증거와 범위

첫 REA 작업은 `analyze_javascript_application`에 아래 여섯 파일만 지정했다. `detail: summary`, 파일당 semantic node 10,000, 전체 50,000으로 분석했다.

- 전체 분석 Evidence: `ev_5e1b94d89dd8c2ba378b6c478df5688356cbd5a6dba3169000e093efe171daaa`
- 요약 Evidence: `ev_1c72d1cd6d3b2ba8ed98614b6723d37249706383fe4221152b0422d264ad2415`
- 입력 디렉터리 최초 SHA-256: `003be988dcf1bc21e246d134a07accbb91f1c6644301bec8d1c72589b25489ca`
- 결과: JavaScript 6/6개 구문 분석, parse failure 0, 읽은 텍스트 714,013바이트, AST 노드 191,159개. application/semantic graph는 **partial**이며 semantic graph는 설정한 상한으로 일부가 생략되었다. 동적으로 결정되는 호출과 내려받지 않은 의존 모듈의 동작은 미확인이다.
- 모듈 목록 Evidence: `ev_e3d85a227545e57d1d9536746651c40218794a5d99bc6a9cbc35dba17ee4eaf2`, `ev_a81ddeb42d1131e24a013c82e25f0a2305184689f4b9da5a57bd7f63f3dcdc32`
- EditorLayout 자산 확인: `ev_adba3301600fc79b6313b6dbbf04a7892190d4ff6972d06a6a4439bced725f2b`
- UserFlow 공통 모듈 자산 확인: `ev_4531e676ecb9556127d331b55dac4814ef69ea886291dc90c396e1ad67d4a6a2`
- ExportFlow 자산 확인: `ev_cfeb72457c25202ad53ac32e4921f9cc9a66d419039feabd28f5bf8c3be52adf`

추가로 실제 로드가 확인된 WireframeViewer 및 아이콘 모듈을 선택 분석했다. 두 번째 작업은 기존 여섯 파일을 다시 분석하지 않았다.

- 전체 분석 Evidence: `ev_bc73ce22921f673d069143344a8c2b19199efbec23e86f99c85a095bf6add86f`
- 요약 Evidence: `ev_c0ce10ee714f0f5a0c786da3b4ed50dfd1a3845fbf2bbfb67867934598d687c2`
- 결과: 선택한 JavaScript 2/2개 구문 분석, parse failure 0, 62,051바이트, AST 노드 9,323개. 선택 범위 안에서 semantic 상한에 의한 truncation은 없으나 미분석 의존성과 동적 관계 때문에 그래프는 partial이다.
- `wireframe-page-skeleton` 문자열에 대한 제한된 incoming trace는 0 matches였다. Evidence `ev_02079a19eed3644d62449a4ae12e3c1a4c9da37afc28a34c1afaf3a13302937b`. 이는 해당 기능 부재를 의미하지 않는다. 실제 문자열과 구성 코드는 아래 원본 자산의 정적 읽기에서 확인했다.

파일은 `.qa-data/reference-js`에 있으며 애플리케이션 소스·배포 파일로 포함하지 않는다. 아래 사실은 REA의 자산 식별·구문 분석에 더해 동일 바이트에 대한 제한된 정적 읽기로 해석했다. 원본 코드를 구현에 복사하지 않는다. 줄 번호는 다운로드한 원본 기준, 열 번호는 0부터 시작한다.

| 공개 자산 | 바이트 | SHA-256 |
|---|---:|---|
| [EditorLayout-Hwn62PSN.js](https://manyfast.io/assets/EditorLayout-Hwn62PSN.js) | 259863 | `690a3fa36af874d0b208e9ae4c6c0940484107141428e0ef3eede18ce1edc524` |
| [railChrome-CtsQTouO.js](https://manyfast.io/assets/railChrome-CtsQTouO.js) | 71031 | `bcbbe9f4cf435918e6108c4a93f275a1b53ac8c58436dfec6811b33e99cf3c50` |
| [metaField-BG88n4Gw.js](https://manyfast.io/assets/metaField-BG88n4Gw.js) | 2160 | `43345d6bd31143135bf728240d1dda64ba4d6804a5b98cd02baf53868c6380ea` |
| [useWireframeVersionQuery-B4Rh0uUU.js](https://manyfast.io/assets/useWireframeVersionQuery-B4Rh0uUU.js) | 73407 | `fd8f0d7f1a00e5e89d0ea08b7e8984e4b3a2aeec84fa9426bb9f078b3d26f04f` |
| [useUserFlowVersionQuery-Tka4NJCy.js](https://manyfast.io/assets/useUserFlowVersionQuery-Tka4NJCy.js) | 270241 | `b78efa564c6543670ec7484d22f7a9b557bbef20f2055f3f5f0490de8e1477f4` |
| [ExportFlow-TdJYgyxD.js](https://manyfast.io/assets/ExportFlow-TdJYgyxD.js) | 37311 | `0afa5610b8d2f64192468af2333d4a0ff5b41232d2ee6c8566fbf393af70497d` |
| [WireframeViewer-DDKx4m4B.js](https://manyfast.io/assets/WireframeViewer-DDKx4m4B.js) | 3212 | `d21f7bfa1251832992e20f4ddbb18b01cbfbf7f2513965e3476336d91d385968` |
| [wfIconSet-CeotvXnT.js](https://manyfast.io/assets/wfIconSet-CeotvXnT.js) | 58839 | `2d22862f24ca8b7b8a213ab898a677dd8bc39c05a108cf04e5f6b51bb434792c` |

## 정적 관찰 및 구현 영향

| 항목 | 정적 관찰 | 위치와 근거 | Planit 반영 판단 |
|---|---|---|---|
| UI 구성 | JSX runtime 호출과 React hooks가 존재하고 공통 vendor, editor, socket manager, rail, export, version 모듈을 분리해 로드한다. 특정 React·상태 라이브러리 버전은 미확인이다. | EditorLayout 1행 import/다수 함수. REA 첫 분석 및 EditorLayout 자산 Evidence | React 선택은 근거와 부합한다. import 파일명만으로 Zustand/TanStack의 실제 버전을 단정하지 않는다. |
| 세로 레일 | 레일 너비 62px, 아이콘 18px, 접기/펼치기와 스크롤 영역을 갖는다. | railChrome 2행 16759열 부근 | 레일 치수와 아이콘 밀도를 화면 관찰과 함께 맞춘다. |
| 상단 조작부 | 편집기 top panel은 높이 44px, 캔버스는 둥근 테두리 카드, 내부 navigator는 드래그 크기 조절 및 최대 45% 폭 제한이 있다. | railChrome 2행 14619열, 1행 25330~26041열 | 탭·도구 영역과 캔버스 외곽을 분리하고 navigator 폭 조절을 후속 재현 항목으로 둔다. |
| AI 패널 | 저장된 표시 상태와 도킹/분리 상태를 관리한다. 상태 기본 chatPanelWidth 432px. 분리 창 기본 412×640, 최소 340×360, 최대 720×860이며 뷰포트 비율 제한도 있다. | useUserFlowVersionQuery 5행 39060·41350열; EditorLayout 20행 33380열, 22행 34685열 | 기본 패널 폭 재현에 활용한다. 떠 있는 창의 드래그·리사이즈는 현재 범위의 추가 항목이며 구현됐다고 주장하지 않는다. |
| 보조 패널 상태 | rightPanelWidth 기본 320px, 범위 280~640px. localStorage에 폭과 와이어프레임 정보 패널 표시 여부를 저장하며, 정보 패널 초기값은 열림이다. | useUserFlowVersionQuery 5행 2461·41414·41632열 | 보조 패널 폭·열림 상태 유지에 활용한다. 여기서 right라는 변수명만으로 실제 배치 방향을 확정하지 않는다. |
| 플로우 버전 | 그룹 아래 버전 목록이 있고 versionNumber, status, referencedFeatureIds, model, pageCount, hasWireframe 필드를 사용한다. 생성 시 임시 그룹/버전을 표시하는 optimistic 상태 코드가 있다. | useUserFlowVersionQuery 5행 20035~20936열 | 현재 Planit 전체 문서 snapshot 이력과 원본의 독립 플로우 그룹/버전 선택 UI는 다르다. 전용 버전 UX를 재현도 후속 항목으로 남긴다. |
| 조회 상태 | 플로우 그룹·버전과 와이어프레임 버전은 문서 ID/버전 ID를 조합한 query key로 분리하고 staleTime 300초를 지정한다. | useUserFlowVersionQuery 5행 20936~22306열; useWireframeVersionQuery 114행 63578열 | 문서·버전별 조회를 독립적으로 유지한다는 구조적 참고다. 원본 서버 주소를 Planit에서 사용하지 않는다. |
| 와이어프레임 생성 | 페이지별 진행·완료 이벤트, 생성/추가/재생성 구분과 성공·실패·취소 개수 집계가 있다. | useUserFlowVersionQuery 5행 24504~25279열, 29306열 부근 | 현재 단일 변경안 생성은 기능 검증용 구현이다. 선택 페이지별 순차 진행과 부분 완료 표시는 높은 재현도를 위한 추가 작업이다. |
| 와이어프레임 표현 | page.dslText를 parser로 AST로 바꿔 렌더링한다. editGraph 사용 시 root/노드 타입/children 수의 정합성을 검사하고 AST에 편집용 ID를 연결한다. 최대 순회 50,000개를 제한한다. | WireframeViewer 1행 180~1500열, 두 번째 REA 분석 | 현재 평면 요소 배열은 간소화된 모델이다. 원본 수준 레이아웃에는 중첩 컨테이너와 안정적인 요소 ID를 갖는 구조가 필요하다. 원본 DSL 자체를 복사할 필요는 없다. |
| 와이어프레임 요소 | page/row/column/spacer/box/table/text/button/input/image/overlay/header/sidebar/body/footer에 대응하는 렌더러 매핑을 확인했다. navigation, overlay 열기/닫기, 뒤로 가기와 편집/핀 계층을 전달한다. | useWireframeVersionQuery 114행 후반 렌더러 매핑, 10985열 부근; WireframeViewer | 최소 후속 우선순위는 row/column/box/table과 header/sidebar/body, 모달·뒤로가기다. 지금의 8개 평면 요소만으로 동일 화면이라고 평가하면 안 된다. |
| 화면 크기 | desktop 1440×900, mobile 390×844, tablet 768×1024 렌더링 치수. skeleton도 같은 desktop/mobile 크기를 쓴다. | useWireframeVersionQuery 114행 12750열; WireframeViewer 1행 1570열 부근 | 현재 지원하는 desktop/mobile 치수는 바로 정렬 가능하다. tablet은 선택 범위에서 후속 지원한다. |
| 화면 색·형태 | 렌더러에 밝은 회색/베이지 계열 배경·테두리와 짙은 회갈색 텍스트, 기본 모서리 6px/카드 8px 설정이 존재한다. | useUserFlowVersionQuery 134행 8168열 | 생성 화면 자체는 중립 색조를 사용하고 앱의 보라색 액센트와 구분한다. 색 값은 사용된 경로별 실제 화면과 대조해야 한다. |
| 내보내기 대상 | COMPLETED이면서 DSL이 있는 페이지만 orderIndex 순으로 내보낸다. 파싱 실패 화면은 건너뛰고 결과 집계에 부분 성공 안내가 있다. | ExportFlow 1행 649열, 215행 3834열 | 일부 실패를 전체 성공으로 표시하지 않는다. Planit 내보내기에서도 포함 범위와 실패를 명확히 해야 한다. |
| 내보내기 형태 | HTML 결과는 화면 목록과 자체 스크립트를 포함한다. 이미지 캡처 때 애니메이션/transition을 끄고 렌더링 프레임을 기다린다. 포맷별 미리보기와 형식 선택 UI가 있다. | ExportFlow 195~215행, 219·242행 | 오프라인 HTML은 현재 방향이 맞다. PNG는 단순 편집기 스크린샷보다 대상 화면을 안정화해 캡처해야 한다. 미리보기 대화상자는 추가 재현 항목이다. |
| 저장 버전 | snapshot 요청은 socket ack와 40초 제한을 사용하며 변경 없음·미승인 제안·busy·연결 오류를 구분한다. | railChrome 1행 1378·2117열 | 서버 방식은 독립 구현하되 저장 상태와 미승인 AI 초안의 구분은 유지한다. |

`metaField`라는 파일명은 PRD 데이터 스키마의 증거가 아니다. 실제 내용은 회의 노트 결정 상태(open/decided/rejected), 삭제 확인, 공통 필드 레이아웃이었다. 파일 이름에 따른 추측을 구현 근거로 사용하지 않는다.

## 제한과 다음 검수

- **OBSERVED_STATIC:** 위 자산의 실제 문자열, 상수, 선언·분기·호출 형태. REA는 이를 실행하지 않았다.
- **INFERRED:** 화면에서 그 상태가 항상 기본값인지, 모든 플랜/권한에서 같은 경로가 적용되는지, 특정 상태 라이브러리의 정확한 이름·버전.
- **UNKNOWN:** 원본 서버 데이터베이스·AI 프롬프트·권한 구현, 다운로드하지 않은 모듈, 생성된 실제 화면의 완성도와 작업 중 시각 상태.
- 사용자가 원본 무료 크레딧 제한을 명시했으므로 조사 과정에서 생성 버튼·재생성·내보내기 기록 API는 호출하지 않는다.
- 실구현 검수는 기능 통과와 원본 일치를 분리한다. 특히 와이어프레임의 평면 요소 모델, 전용 버전 그룹, 분리형 AI 패널, 내보내기 미리보기는 현재 구현과 원본 사이의 확인된 차이다.

## 2차 구현: 세 기능에 대한 집중 추적

이 절은 위 1차 조사 당시의 구현 차이를 갱신한다. 중첩 와이어프레임, 독립 플로우 그룹·버전, 분리형 AI 패널을 구현한 뒤 기존 REA Evidence의 선택 모듈을 추적했다. 광범위 분석을 다시 실행하지 않았고 추가 다운로드나 원본 서비스 호출도 하지 않았다. REA 모듈 추적은 관련 파일·정적 관계의 연결 근거이며, 아래 세부 동작은 같은 해시의 자산을 제한적으로 읽어 확인했다. 추적에 포함된 모든 관계가 특정 UI 기능에서 실행된다고 해석하지 않는다.

| 집중 추적 | Evidence | 결과 및 범위 |
|---|---|---|
| EditorLayout 모듈 outgoing trace | `ev_42cbd03c5aae2154172cb14ad3005d2bfd48535f1305606846b4d605124dafb0` | seed 2개, 노드 294개, 관계 952개, terminal path 19개. 원본 graph가 partial이며 정적 추론 관계가 포함된다. |
| UserFlow 모듈 outgoing trace | `ev_721fb331a89675669b9f9ac0b4dc46c5293df61d811b3071c3b99d9d37ff4e1d` | seed 2개, 노드 169개, 관계 243개, terminal path 8개. 정적 연결은 서버 실행·응답의 증거가 아니다. |
| WireframeViewer 모듈 outgoing trace | `ev_e1b42f488976df6774b81707825bf5a9b5ba6560f58fc5f127f699489f65b276` | seed 2개, 노드 9개, 관계 14개, terminal path 2개. 미분석 의존성과 동적 호출은 계속 미확인이다. |
| 정확한 source-module 재조회 | EditorLayout `ev_1813d16c51cc99edc5611b9d9245cf0aba44e5846e3df2676cfe9d6c6c79b4bf`; UserFlow `ev_99986e1913892f461c872d99846ef64f8c95a4339f878f1ccbd4c37317de76af`; WireframeViewer `ev_79bfc8c80436f0d6d784da4e4ee98857e9dab5d76b1e15ed6732ea517e0cf21a` | 각 파일의 AST source-module, ESM 형식, 원본 해시와 범위를 재확인. 선택 item 조회가 완전하다는 것은 원본 application graph 전체가 완전하다는 뜻이 아니다. |

요약 receipt는 `.qa-data/reference-evidence/phase2-summary.json`에 보관했다. 이 파일은 전체 Evidence를 대신하는 것이 아닌, 같은 세션의 retained Evidence ID와 범위·개수만 저장한 분석자 요약이다.

| 기능 | 확인된 세부 동작 | Planit 구현 연결 및 차이 |
|---|---|---|
| 떠 있는 AI 패널 | **OBSERVED_STATIC:** 기본 412×640, 최소 340×360, 최대 720×860. 실제 허용 크기는 컨테이너/뷰포트 폭 55%, 높이 85%로도 제한한다. 크기 localStorage 저장, 헤더 포인터 드래그, 우하단 리사이즈가 있다. 표시 상태와 popped-out 상태는 별도로 저장한다. EditorLayout 20행 33380열, 22행 34685열; UserFlow 5행 39060·41350열. | `src/components/AiPanelFrame.tsx`는 도킹/분리/닫기, 위치·크기 유지 및 화면 안으로 보정하는 독립 구현이다. 원본의 412×640 기본 크기와 범위를 시각 비교 기준으로 삼는다. 현재 구현의 최대 크기는 화면에서 16px 여백을 뺀 값으로도 제한하므로 원본 55%/85% 제한과 작은 화면에서 차이가 있다. 도킹 폭 432px은 별도 상태다. |
| 패널 실화면 대조 | **OBSERVED_RUNTIME, 상위 에이전트의 읽기 전용 관찰:** 1440×1000 화면에서 떠 있는 패널 x=86, y=240, 너비 412, 높이 640. 메뉴 표현은 창으로 띄우기/패널로 되돌리기/닫기. 원본에서 생성은 실행하지 않았다. | 정적 상수와 실제 렌더 크기가 일치한 사례다. 위치는 이 뷰포트에서 관찰된 값이며 모든 화면의 고정 좌표로 사용하지 않는다. REA 정적 Evidence가 이 실화면 좌표를 측정했다고 주장하지 않는다. |
| 플로우 그룹·버전 분리 | **OBSERVED_STATIC:** 그룹은 순서·생성일과 versions 배열을 갖고 버전은 번호·상태·참조 기능·모델·페이지 개수·와이어프레임 여부를 갖는다. 생성은 임시 그룹/버전을 넣고 재생성은 같은 그룹에 다음 번호를 붙이는 optimistic 경로가 있다. 그룹 및 상세 조회 key가 문서/버전 ID로 분리된다. UserFlow 5행 20035~22306열. | `shared/schema.ts`, `server/store.ts`, `FlowVersionPanel.tsx`에 그룹/버전을 별도 저장하고 선택 상태를 지속한다. 플로우와 화면은 버전별로 독립 유지한다. 새 빈 버전과 sourceVersionId를 지정한 복사 버전을 구분한다. 생성 중 임시 원본 서버 버전의 진행 상태까지 같다고 주장하지 않는다. |
| 플로우 수정 맥락 | **OBSERVED_STATIC:** 생성/재생성 요청 경로가 구분되고 편집 결과에 source version, baseline, new-version 분기와 그룹/특정 버전 query 무효화가 있다. UserFlow 5행 51204열; EditorLayout 22행 3618열. **OBSERVED_RUNTIME, 상위 에이전트 관찰:** 그룹 목록, 버전 이름/날짜, 더보기 메뉴가 보인다. | Planit AI 실행과 제안은 시작한 flowVersionId를 저장한다. 다른 버전에서 승인하면 409로 중단하고 제안은 pending을 유지한다. 원래 버전으로 돌아오면 정상 충돌 검사를 거쳐 승인할 수 있다. 이것은 독립 구현의 안전한 맥락 처리이며 원본 서버의 동시성 규칙을 역추정한 결과는 아니다. |
| 중첩 레이아웃 | **OBSERVED_STATIC:** WireframeViewer는 DSL을 AST로 파싱하고 편집 graph와 root/type/children 수를 대조한다. page/row/column/box/table/header/sidebar/body/footer 등으로 렌더링을 나눈다. WireframeViewer 1행 180~1500열; useWireframeVersionQuery 114행 렌더러 매핑. | Planit은 `WireElement.children`에 실제 하위 객체를 넣는 재귀 JSON 구조다. 중첩 선택/편집과 HTML 내보내기를 같은 구조에서 수행한다. 원본 DSL과 graph 구현을 복사하지 않았다. 원본의 순회 상한 50,000과 달리 깊이 8, 화면당 500개로 제한한다. |
| 이동·모달·뒤로가기 | **OBSERVED_STATIC:** overlay target이 별도 action 메타데이터에서 직렬화되고 close/overlay:close/modal:close는 닫기 동작으로 처리된다. 렌더러가 onNavigate와 onNavigateBack, sharedNavigationDsl, currentPageId, sectionTopPageIds, incomingPageIds를 받는다. UserFlow 134행 2437열; useWireframeVersionQuery 114행 9168·10985열. | Planit의 navigate/back/openModal/closeModal과 같은 화면의 modal ID 참조로 연결한다. 제공된 잘못된 참조는 서버에서 거부하고, 연결 편집 중 null 대상은 초안으로 허용한다. HTML은 오프라인에서도 화면 이동·뒤로가기·모달 열기/닫기를 수행한다. 원본의 공유 내비게이션 자동 추론이나 모든 section/back 동작과 동등함은 미확인이다. |

독립 API 검수에서는 버전 전환·비활성 버전 참조 보호·다른 버전 승인 거부 후 복귀 승인·중첩 요소 백업/복원·기존 SQLite 데이터 마이그레이션을 확인했다. 이 검증은 원본과의 시각적 일치나 실제 AI 출력 품질을 증명하지 않는다. 브라우저 검수와 실제 Groq 검증 결과는 `docs/qa-loop.md` 및 별도 실행 보고서에 기록한다.

첫 실제 Groq 중첩 생성 smoke에서는 모델이 children에 하위 객체 대신 ID 문자열 배열을 반환하여 스키마 검증에서 안전하게 실패했다. 기존 문서는 바뀌지 않았다. 실패 자료는 별도 합성 프로젝트의 `.qa-data/live-nested-1792119708558/smoke.sqlite`에 유지한다. fixture를 통과한 재귀 자료 구조와 실제 모델의 구조 준수는 별도 검수 항목이다. `server/ai.ts`의 와이어프레임 전용 지시에 전체 하위 객체, 각 깊이의 필수 네 필드, 부모 children에 직접 포함하는 규칙과 짧은 유효 3단계 JSON 예시를 추가했다. 수정 뒤 관련 서버 버전 테스트 7개와 타입 검사는 통과했다.

프롬프트 보완 뒤 실제 Groq 재시도는 **통과**했다. `.qa-data/live-nested-1792119874895/report.json`에는 `openai/gpt-oss-120b`의 생성 및 승인 3,559ms, 화면 1개, 요소 9개, row/body/modal 중첩 구조를 기록했다. 복사한 버전을 수정해도 원래 버전이 유지됐고, 서버 재시작 후 저장 데이터 동일성도 확인했다. 이는 해당 합성 요청 1회의 실제 성공 증거이며 임의의 요청에 대한 품질·성공률 보장은 아니다. 원본 Manyfast의 생성 크레딧은 이 검증에 사용하지 않았다.

이 실제 생성 자료의 검수에서 프런트엔드 컨테이너 text 누락이 발견되어 별도 수정 대상으로 잡았다. HTML 내보내기 경로도 비교했으며 `server/exports.ts`는 header/sidebar/body 등 컨테이너 text를 `wf-container-label`로, modal text를 `h2`로 이미 보존하고 HTML escape를 적용한다. `.qa-data/verify-container-text.ts`로 네 유형 각각의 본문, 자식 내용, 순서, escape를 직접 검증해 통과했다. 따라서 같은 누락 문제를 이유로 내보내기 코드를 변경하지 않았다.

남은 원본 일치 미확인 영역은 페이지별 생성 진행·부분 완료, tablet 모드, 공유 내비게이션의 자동 처리, 내보내기 미리보기와 일부 실패 집계, 원본 AI 프롬프트/서버 동시성·권한 동작이다. 1차 표의 세 기능 관련 구현 전 차이는 위 구현으로 좁혀졌으나, 이를 서비스 전체의 완전한 복제로 평가하지 않는다.

## 3차 차이 감사: 생성 목적지·삭제·버전별 화면 생성

범위는 같은 공개 자산과 같은 세션의 retained Evidence다. 전체 application 분석을 다시 실행하지 않았다. 원본 생성·삭제·변경 요청과 실제 Groq 호출도 수행하지 않았다. 이 절은 구현 전 감사 기록이며 제안하는 계약을 구현 완료로 표현하지 않는다.

자산 식별과 정적 범위는 UserFlow source-module Evidence `ev_99986e1913892f461c872d99846ef64f8c95a4339f878f1ccbd4c37317de76af`, EditorLayout source-module Evidence `ev_1813d16c51cc99edc5611b9d9245cf0aba44e5846e3df2676cfe9d6c6c79b4bf`, 앞 절의 outgoing module trace를 재사용했다. 다음 네 exact literal trace는 모두 **partial graph 내 no-match**였으며, 아래 관찰을 기능 부재로 해석하는 데 사용하지 않았다. 실제 동작 분기와 값은 동일 해시의 소스 바이트를 TypeScript AST로 제한해서 읽었다.

| Exact trace seed | Evidence |
|---|---|
| `/agent/user-flow/generate` | `ev_9282d799e62a11071b81a01d24c7cf273c49d6ea884d2c9997581988561120ed` |
| `/agent/user-flow/regenerate` | `ev_a4badc7dc40577d54fce0da3a60be6b48d8962303be0d2d91d0d0d2cdb5b6f23` |
| `/agent/wireframe/regenerate` | `ev_ee88f5d749a715b786c208c2fb39b6ff506f1d9fe02d1ab8abe0f2343f72ad30` |
| `userflow:version-deleted` | `ev_7271c1ce110b5e07e0b13ead81e670e06934158b0ff55f3bae22e4c1abda46f3` |

선택 trace 요약은 `.qa-data/reference-evidence/phase3-summary.json`, 제한적 정적 읽기 도구는 `.qa-data/reference-phase3*.mjs`에 남겼다. 이 도구들은 원본 JavaScript를 실행하지 않는다.

### 우선순위와 근거

| 우선순위 | 원본에서 관찰한 사실 | 현재 로컬과의 차이·판단 |
|---|---|---|
| P1 — 플로우 생성·재생성의 목적지 | **OBSERVED_STATIC:** generate는 새 임시 그룹과 v1을 추가한다. regenerate는 전달된 groupId에 다음 versionNumber를 append한다. 요청에는 regenerate인 경우 groupId와 baseVersionId를 더한다. UserFlow 5행 20035~20936·51204열. 짧은 발췌: `c.mode==="regenerate"&&(L.groupId=c.groupId,L.baseVersionId=c.baseVersionId)`. | 현재 `AIService.resolve`는 승인된 flow를 선택 버전에 commit한다. 수동으로 수정본을 먼저 만들 수 있지만, AI 생성/재생성만으로 원본과 같은 이력이 만들어지지는 않는다. 새 그룹 / 같은 그룹의 새 버전 / 현재 버전 부분 편집을 사용자가 구분하는 명시적 생성 목적지가 최우선이다. 승인 전에는 저장된 기존 버전을 변경하지 않고, 승인 시 목적지 생성과 제안 적용을 하나의 트랜잭션으로 처리하는 방안을 권장한다. |
| P1 — 생성과 부분 편집을 구분 | **OBSERVED_STATIC:** EditorLayout은 editUserFlow 성공 후 원래 버전 baseline과 결과 versionId를 비교하고 `d.target==="new-version"` 분기를 갖는다(22행 3618열). 이 구문은 특정 부분 편집 결과가 새 버전으로 갈 수 있음을 보여준다. | **UNKNOWN:** 모든 부분 편집이 새 버전인지, 현재 버전 편집을 언제 택하는지, 서버 기본값은 미확인이다. 따라서 모든 AI 수정 요청을 무조건 새 그룹으로 옮기는 구현은 근거가 없다. 현재의 승인·부분 변경 기능은 유지하며 목적지를 별도 입력으로 다루는 편이 적합하다. |
| P1 — 버전별 화면 생성 범위를 보존 | **OBSERVED_STATIC:** wireframe generate/append/regenerate가 분리된다. generate는 userFlowVersionId/deviceType/selectedPageNodeIds/prompt/model, regenerate는 baseVersionId와 userFlowVersionId/deviceType/selectedPageNodeIds/prompt, append는 baseVersionId와 selectedPageNodeIds/prompt 및 선택적 userFlowVersionId를 전송한다. UserFlow 5행 29306열 이후. 짧은 발췌: `v.baseVersionId=n.baseVersionId` 및 `v.selectedPageNodeIds=n.selectedPageNodeIds`. | 로컬은 시작한 flowVersionId와 entityIds를 저장하고 재시도에도 유지하여 버전/선택 범위 보호는 구현돼 있다. 다만 AI 대화창은 생성·추가·재생성 목적이 분리되지 않으며 화면 결과를 해당 플로우 버전의 단일 wireframes 배열에 적용한다. 페이지 선택 + 생성 목적 표시가 다음 우선순위다. 원본의 별도 wireframe version 이력 전체를 재현하려면 별도 계약이 필요하다. |
| P2 — 플로우 버전 삭제 생명주기 | **OBSERVED_STATIC:** `userflow:version-deleted` socket 이벤트는 그룹과 해당 문서의 모든 플로우 버전 상세 query를 무효화하고 dirty 상태를 표시한다. EditorLayout 1행 11200~12200열. 짧은 발췌: `s.on("userflow:version-deleted",o)`. | 로컬 그룹/버전은 생성·이름 변경·선택·복사를 지원하고 삭제 API/메뉴는 없다. 삭제 자체의 사용자 흐름은 확인된 차이다. 삭제 구현 시 선택 중 버전의 다음 선택, 그 버전의 화면, 진행 중 작업 및 미승인 제안의 처리까지 함께 정의해야 한다. **UNKNOWN:** 원본 그룹 삭제 API, 휴지통 여부, 복원 기간, 영구 삭제 및 마지막 버전 삭제 규칙은 보유 자산에서 확인되지 않았다. |
| P2 — 페이지별 생성 진행과 부분 결과 | **OBSERVED_STATIC:** started/pages_planned/page_start/page_progress/page_complete/complete 이벤트를 처리하고 pageId별 DSL, 성공·실패·취소 수를 관리한다. complete 후에도 이미 완료된 페이지를 조회할 수 있도록 버전 query를 갱신한다. UserFlow 5행 23900~25400·27600~29100열. | 로컬은 전체 JSON 응답을 검증한 뒤 변경 제안 하나를 만든다. 정확한 현재 안전 경계는 명확하지만 원본처럼 페이지별 진행/부분 완료를 보여주지 못한다. 단순 가짜 진행률을 추가하지 말고, 향후 실제 페이지 작업 단위와 실패 보존 정책을 구현해야 한다. |

### 확인된 범위와 남은 불확실성

- **OBSERVED_STATIC:** 원본의 wireframe 목록 key는 documentId, 상세 key는 documentId+wireframe versionId이며, 플로우 페이지 목록 key는 documentId+user-flow versionId+deviceType이다(UserFlow 5행 21800~22500열; useWireframeVersionQuery 114행 63465열). 두 버전 식별자가 별도라는 구조는 확인된다.
- **INFERRED:** 원본 재생성의 의도는 이전 결과를 기준으로 별도 결과를 관리하는 것이다. 하지만 wireframe regenerate/append가 항상 새 versionId를 반환하는지, 같은 ID를 갱신할 수 있는지는 프런트엔드 요청·응답 코드만으로 확정하지 않는다.
- **OBSERVED_STATIC:** 플로우 노드 삭제는 시작 노드를 막고, 삭제할 노드/간선 집합을 한 트랜잭션으로 지우며 사용하지 않는 섹션을 정리한다. 시작 노드가 포함된 섹션 삭제도 막는다(UserFlow 5행 5190·10500~11000·15300열). 이는 버전 자체의 삭제와 구분되는 규칙이다.
- **OBSERVED_STATIC:** 와이어프레임 취소는 isCancelling과 cancelAcknowledged를 구분하고 완료/진행/취소 개수를 표시한다. 확인 응답 전후의 대기 한도도 다르다(UserFlow 5행 32500~33900열). 이 경로가 서버에서 어떤 과금·원자성을 보장하는지는 **UNKNOWN**이다.
- 원본 서버 삭제·복원 정책이나 과금 처리, 생성 품질, 자동 목적지 선택 규칙은 이번 읽기 전용 감사로 확인하지 않았다. 관찰한 공개 클라이언트 분기와 로컬에서 선택할 안전한 정책을 구분해 계약을 확정한다.

### 3차 감사 후 구현한 계약

앞의 우선순위 표는 구현 전 관찰이다. 이후 P1 생성 목적지 구분을 구현했다. `flowGenerationMode`는 edit/new-version/new-group이며, 생략된 기존 요청과 저장된 제안은 edit로 해석한다. 새 버전·새 그룹 모드는 승인 시에만 결과를 만들고 선택하며 `resultFlowVersionId`를 제안에 남긴다. 거절·취소·실패에는 빈 버전을 만들지 않는다. 결과가 원본과 같은 그래프여도 명시된 새 목적지는 승인 후 생성한다. 원본 flow/screens는 보존하고 새 결과의 wireframes는 빈 배열로 시작한다. 세부 타입, API, 충돌·재시도·원자성은 `docs/contract.md`의 Phase 3 절에 명시했다.

**TESTED_LOCAL:** 새 생성 목적지 서버 테스트 9개와 기존 app/version 테스트를 합한 24개가 통과했다. 승인 전 무변경, 원본 버전 전체 보존, 원본 페이지 제거가 포함된 새 그래프, 최신 기능 참조 검사 및 rollback, 잘못된 선택 버전에서 pending 유지 후 복귀 승인, 원본 수정 충돌, 중복 승인, 재시작 후 결과/모드 유지가 포함된다. 결과는 `.qa-data/backend-flow-generation-tests.json`에 남겼다. 이 단계에서 실제 Groq 호출과 원본 생성·삭제 호출은 하지 않았다.

**OBSERVED_RUNTIME, 상위 에이전트의 읽기 전용 대조:** 원본 플로우 탭에는 새 유저플로우 생성과 수정본 생성이 별도 작업으로 표시된다. 생성은 누르지 않았다. 이는 앞서 본 generate/regenerate의 정적 분기를 UI 관찰로 보강한다.

**독립 구현 결정:** 원본 클라이언트는 생성 시작 때 임시 그룹/버전을 표시하지만 Planit은 승인 트랜잭션 때 목적지를 확정한다. 기존 승인 절차와 안전한 재시도를 유지하기 위한 선택이며 원본 서버의 승인·동시성 규칙을 재현했다고 주장하지 않는다. 플로우 버전 삭제·복원, 별도 와이어프레임 버전 이력과 페이지별 부분 결과는 이번 구현 범위에 넣지 않았다.

분리 패널의 원본 clamp 우선순위도 좁혀 확인했다. EditorLayout 20행의 Qr 함수는 비율/최대/남은 공간의 최소값을 먼저 구한 다음 최소 340×360을 우선 적용한다. Planit은 일반 뷰포트에서 이 비율과 최소 우선순위를 반영하고, 뷰포트 자체가 그 최소보다 작을 때만 조작부가 화면 밖으로 사라지지 않도록 축소한다. 원본의 offsetParent 기준과 로컬의 viewport 기준이 완전히 같다고 평가하지 않는다.

## 4차 감사: 화면 버전 이력과 남은 편집 기능

2026-10-16. 이전 Evidence의 retained reference는 현재 REA 연결에서 유효하지 않아 `evidence_integrity_mismatch/missing`을 반환했다. 동일 요청을 반복하지 않고 이미 보관한 공개 자산 중 `useWireframeVersionQuery-B4Rh0uUU.js`, `useUserFlowVersionQuery-Tka4NJCy.js` 두 파일만 다시 분석했다. 새 다운로드·원본 생성·계정 데이터 조회는 없었다.

- 전체 분석: `ev_e9138ff8bcfa2013cc5bc555dfa5ecb0c42a3324572990df02f55fba424b785b`.
- 요약: `ev_128eb937afed0b0850fe4ed40da221250e5ad3b113d2e8f22130b209d84245f8`. 보관 파일 `.qa-data/reference-evidence/phase4-analysis.json`.
- 선택한 두 자산의 SHA-256은 앞의 표와 동일하다. 343,648바이트, JavaScript 2개 구문 분석 성공, parse failure 0. 나머지 6개 자산은 이번 분석에서 제외했다. semantic graph는 파일당 10,000/전체 20,000 노드 상한으로 partial이며 미분석 의존성·동적 호출은 UNKNOWN이다.
- 해당 바이트를 TypeScript AST로 제한해서 읽은 위치·문맥은 `.qa-data/reference-evidence/phase4-static.json`에 보관한다. 코드 실행이나 로컬 구현으로의 복사는 하지 않는다.

| 질문 | 확인된 근거 | 구현에 적용하는 범위 |
|---|---|---|
| 화면 버전과 생성 방식 | **OBSERVED_STATIC:** UserFlow 5행 29334~30000열. generate/append/regenerate 경로가 갈리고 regenerate/append에 `baseVersionId`, `userFlowVersionId`, `selectedPageNodeIds`를 전달한다. 와이어프레임 조회도 별도 version ID를 사용한다. | 플로우 버전별 독립 화면 버전 이력. 현재 편집과 추가/재생성을 구분한다. 승인 시 새 버전 확정, 기존 화면 보존, 이중 버전 문맥·충돌 검사는 독립 설계다. |
| 태블릿 규격 | **OBSERVED_STATIC:** Wireframe 114행 13072·28809열. mobile 390×844, tablet 768×1024, desktop 1440×900 분기. | 화면 생성·편집·미리보기·HTML/PNG의 Tablet 규격에 사용한다. |
| 공유 내비게이션 | **OBSERVED_STATIC:** Wireframe 114행 11011~14000열. `sharedNavigationDsl`을 파싱해 header/sidebar/footer를 기존 영역에 우선 적용하며 `nav=none`은 제외한다. | 선택한 공통 영역을 선택 화면에 명시적으로 적용하는 도구를 추가한다. 각 화면의 본문을 보존하고 복사 후 개별 편집한다. 원본의 공유 DSL 자동 추론·실시간 동기화와 같은 구현이라고 주장하지 않는다. |
| 삭제/복구 | 이전 런타임 메뉴와 version-deleted 이벤트 이외에 원본의 휴지통·최종 버전 처리 정책은 **UNKNOWN**. | 로컬에서는 되돌릴 수 있는 보관/복구, 마지막 활성 버전 보호를 독립 설계한다. 원본 삭제 API를 시험하지 않는다. |
| 부분 생성 진행 | UserFlow 5행의 page별 진행·완료와 success/failed/cancelled 집계 분기는 **OBSERVED_STATIC**. | 스트리밍 응답에서 구조 검증을 통과한 완전한 화면 객체만 세어 `화면 데이터 수신`으로 표시한다. 전체 응답 검증·승인과 구분하며 부분 객체를 저장하지 않는다. 페이지별 부분 성공 승인·실패 페이지 재시도는 별도 작업 계약이 필요하다. |

## 5차 감사: 페이지별 실패와 공유 영역의 갱신

2026-10-16. 같은 REA 연결의 4차 분석 Evidence를 재사용했다. 원본 사이트 요청이나 자산 재다운로드 없이 모듈 페이지를 조회한 Evidence는 `ev_23a3e5bac86332f6ced6f6ce3bb3536dafc0af177497a8d00978d60f492336fb`다. `sharedNavigationDsl`, `page_complete` 문자열을 각각 outgoing 방향으로 추적한 결과는 `ev_5bbb75e88279b7cd2977b4dde92a8be64d4c5a68880bd3e9d23ece827966ebe5`, `ev_4a3c902fafcbfa80c966f2e29c093afd9c4fc2a3e137188ffd0e3a4ea5a434fb`이며 둘 다 partial graph에서 no-match였다. 이는 기능 부재의 근거가 아니다. 이력은 `.qa-data/reference-evidence/phase5-rea.json`에 보관한다.

새 분석을 반복하는 대신 기존 두 파일의 동일 해시 바이트를 TypeScript AST로 한정 조회했다. `.qa-data/reference-evidence/phase5-static.json`에 위치와 짧은 문맥을 남겼으며 자산을 실행하지 않았다.

| 대상 | 관찰 | 구현 결정과 미확인 범위 |
|---|---|---|
| 페이지 작업 | **OBSERVED_STATIC:** UserFlow 5행 24902열 부근에서 page_complete 후 page별 버퍼를 제거하고 콜백을 호출한다. complete는 successCount/failureCount/cancelledCount를 합산한다. | 페이지별 상태와 성공 결과 보관을 구현한다. 실제 서버 재시도 단위·횟수·중복 방지·과금·취소 후 부분 결과 정책은 **UNKNOWN**. 순차 호출, 명시적 실패 페이지만 최대 3회 시도, 취소 후 명시적 제안 준비, 승인 시 새 화면 버전 확정은 독립 설계다. |
| 공유 영역 | **OBSERVED_STATIC:** Wireframe 114행 12000~13900열에서 sharedNavigationDsl을 파싱한 헤더/사이드바/푸터가 있으면 개별 영역 대신 사용하고 본문은 원래 값을 유지한다. nav=none이면 공유 영역을 적용하지 않는다. | 같은 화면 버전의 명시적 기준/대상 연결과 자동 반영, 개별 연결 해제를 구현한다. 대상 영역은 기준에서 편집하며 본문은 독립이다. 원본 공유 DSL 작성·자동 추론·편집 권한·실패 복구 정책은 **UNKNOWN**이다. |

로컬은 연결된 내용을 저장 시 실제 요소 트리에 반영하여 편집·백업·HTML/PNG가 일치하도록 한다. 원본/영역 삭제 시 마지막 내용을 보존하고 연결을 해제한다. 부분 성공 승인에서 실패 화면의 내용을 바꿀 연결은 새 결과 버전에서만 해제하고 승인 화면에 알린다. 기존 원본 버전은 보존한다. 이 정책을 원본의 미확인 서버 동작과 동일하다고 평가하지 않는다.

## 6차 감사: 공통 내비게이션 자동 추론의 경계

2026-10-16. 4차의 동일한 두 공개 자산과 retained Evidence를 재사용했다. 원본 사이트의 조회·생성 요청, 자산 재다운로드, 실제 Groq 호출은 하지 않았다. `sharedNavigationDsl` 속성의 backward-provenance 추적 Evidence는 `ev_0800fe6ab2007121520a6a3d1a8b224a381936b5351ee813d5aedf6baceefe6a`다. 응답이 MCP 전송 상한을 넘었지만 기록은 보존되었다. 해당 trace는 analysis view를 지원하지 않아 전체 retained bundle을 `.qa-data/reference-evidence/phase6-retained-bundle.json`으로 내보내고 로컬에서 정확한 기록을 읽었다. 분석을 반복 실행하지 않았다.

- **PARTIAL / UNKNOWN:** seed match 0, traversed nodes/relations 0, relevant unknowns 8,238(ambiguous-target/incomplete-module). 추적 자체의 artifact identity도 unavailable이다. 원본 서버의 공유 영역 선택·추론 알고리즘을 복원한 근거가 아니며, 미일치를 기능 부재로 해석하지 않는다. 원래 선택한 두 파일의 해시는 4·5차와 동일하고, 나머지 여섯 파일은 이 분석 범위 밖이다.
- **OBSERVED_STATIC:** 동일 바이트의 AST 한정 조회에서 Wireframe 114행 13322열 부근의 `nav === "none"`은 공유 영역 적용을 비활성화한다. 공유 DSL이 있으면 header/sidebar/footer를 우선 사용하고 body는 개별 화면 것을 유지하는 분기는 계속 확인된다. 페이지 내부의 비슷한 영역을 어떤 기준으로 공유 영역으로 승격하는지는 확인되지 않았다.
- **IMPLEMENTED / independent design:** 로컬은 같은 기기의 영역 구조·문구·스타일·순서·이동 동작이 일치할 때만 후보를 자동 추론한다. 요소 ID는 위치 대응으로 비교하고, 같은 영역 안의 모달 참조는 상대 경로로 비교한다. 다른 영역/본문 모달 참조, 여러 기준 소유자, 중복 영역, 빈 틀은 자동 연결하지 않는다. 명시적 검토 후 기존 요소 ID와 본문을 유지하며 연결 메타데이터만 추가한다.
- **IMPLEMENTED / independent design:** 화면별 자동 찾기 제외 설정은 후보 발견만 제어한다. 기존 명시적 연결이나 자체 내비게이션을 숨기지 않는다. 따라서 원본 `nav=none`의 렌더링 의미와 동일한 기능이라고 표현하지 않는다. 모델이 이 사용자 설정을 변경하지 못하도록 생성 출력에서 제외하고 기존 화면 ID 기준으로 서버가 보존한다.

추적 요약·한정 AST 문맥·파일 해시는 `.qa-data/reference-evidence/phase6-analysis.json`에 보관한다. 약간 다른 메뉴의 의미적 통합, 없는 영역의 자동 작성, 원본의 비공개 추론·과금 정책 및 채워진 원본 화면의 픽셀 비교는 미확인 또는 후속 범위다.
# 7차 감사: 공개 화면 자료와 제한된 실제 공급자 검수

2026-10-16. 원본 계정의 생성·재생성·삭제·내보내기는 실행하지 않았다. [공식 와이어프레임 문서](https://docs.manyfast.io/plan/wireframe)와 [공식 유저플로우 문서](https://docs.manyfast.io/plan/user-flow)를 읽고, 와이어프레임 문서가 연결한 2026-08-21 공개 스크린샷을 인앱 브라우저에서 직접 확인했다. 공개 문서의 시점과 현재 서비스의 차이가 있을 수 있다.

- **OBSERVED_DOCUMENT_IMAGE:** 오른쪽 전체 페이지 목록과 섹션 구분, 중앙 프레임 내부 스크롤, 하단 페이지 이동·현재/전체 번호·재생성·직접 편집, 배율 및 맞춤 도구를 확인했다. 로컬에서는 미리보기의 배치와 탐색에 반영하며 기존 상세 편집 기능은 유지한다.
- **DOCUMENTED:** 생성 대상 검색 및 섹션 선택, 생성 중 이미 만들어진 페이지 열람, 빈 공간에서 상호작용 가능한 요소 표시가 설명되어 있다. 실제 유료 생성 시나리오를 실행해서 관찰한 것은 아니다.
- **OBSERVED_STATIC:** REA로 보관된 `WireframeViewer-DDKx4m4B.js` 한 파일만 새 분석했다. `ev_8c0e8b717ed9f7e049fd5a08d9fba0025cefae90eb84a079a5d71b271c00d524`, 요약 `ev_ebbeccff244bf8511186df548512feae7fcb07efcd2bc5fb0c06d12d6f7a3ea6`. 3,212바이트, AST 937노드, parse failure 0, 나머지 7개 자산 미분석. 모듈 목록과 영수증은 `.qa-data/reference-evidence/phase7-viewer.json`에 보관한다.
- 같은 자산의 정적 읽기에서 page DSL과 edit graph 경로, 생성 전 skeleton의 mobile 390×844 / desktop 1440×900 분기, navigation/back/shared-navigation 입력 전달을 확인했다. 이 래퍼만으로 툴바 구현이나 비공개 생성 알고리즘을 추정하지 않는다. 관계 그래프는 partial이고 213개 semantic unknown이 있다.

| 항목 | 원본 근거와 미확인 범위 | 로컬 계약 |
|---|---|---|
| 생성 중 임시 버전 | 공개 클라이언트의 임시 표시 분기는 확인. 서버 영속화·복구 정책은 미확인 | 작업 결과를 따로 보관하고 사용자가 승인할 때 새 버전 확정 |
| 페이지 실패·재시도 | 공개 클라이언트에 페이지 상태/집계. 실패 결과 보존·재시도 과금의 정확한 서버 규칙은 미확인 | 성공 보존, 실패/취소 페이지만 명시적 재시도, 페이지당 최대 3회 |
| 취소·화면 이탈 | 문서에 생성 중 동작 설명. 이미 전송된 모델 요청의 결제·네트워크 취소 보장은 미확인 | 늦은 결과 무시, 완료 결과 재시작 후 검토, 미승인 원본 보존 |
| 공유 메뉴 추론 | 공유 DSL 렌더링과 제외 분기 확인. 모델 프롬프트·유사도 기준은 미확인 | 이동 대상이 같은 메뉴만 제한적으로 표현 통합, 없는 영역 추가는 검토 후 적용 |
| 실제 AI 통합 | 원본 AI 품질·정책과는 별도 검수 | 합성 데이터의 Groq 5요청(4성공·429 1회), 페이지 재시도·부분 승인·취소 후 재시작을 확인. [상세](live-integration.md) |

상태·참조·원본 보존의 기능 검증과 원본 시각 일치는 독립 판정이다. 공개 스크린샷을 검토했지만 동일 콘텐츠를 원본에서 생성하지 않았으므로 픽셀 일치율을 산정하지 않는다.

