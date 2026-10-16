# UX/UI 개선 조사 — 2026-10-16

현재 React 19·Vite·자체 CSS 기반 앱과 공개 공식 문서·저장소를 함께 검토했다. 이번 작업은 조사와 개선안 작성이다. 라이브러리·스킬 설치나 제품 코드 변경은 하지 않았으며 Groq와 원본 Manyfast 호출은 0회다. 브라우저에서는 현재 3100 대시보드의 화면과 계산된 스타일을 읽었다. 편집기 관련 발견은 소스 검토 및 앞선 런타임 검수 기록에 근거하며 새 전체 런타임 감사로 간주하지 않는다.

## 좋은 UX/UI의 판단 기준

이 제품의 핵심 작업은 기획 작성, AI 결과 검토, 문서와 화면 사이 이동, 버전 관리다. 좋은 디자인은 사용자가 현재 위치와 다음 행동을 이해하고, 내용을 읽고 비교하며, 실수에서 회복할 수 있도록 돕는다. 시각적 품질은 글자·간격·색·정렬의 일관성과 정보의 우선순위로 평가한다. Nielsen Norman Group의 상태 가시성, 일관성, 오류 예방, 사용자 통제, 인지 부담 감소 원칙을 실제 작업에 적용한다. [NN/g 공식 휴리스틱](https://www.nngroup.com/articles/ten-usability-heuristics/)

| 기준 | 이 앱에 적용할 설계 | 검증 방법 |
|---|---|---|
| 명확한 위계 | 현재 프로젝트·문서·버전과 주요 행동이 먼저 보이게 배치 | 사용자가 도움 없이 현재 위치와 다음 행동을 설명 |
| 읽기 쉬움 | Pretendard 기본 14px, 본문·입력·중요 조작에 실제 적용, 보조문구 대비 확보 | 브라우저 computed style·대비·확대 검사 |
| 작업 효율 | 편집 영역의 최소 폭 확보, 보조 패널의 접기·전환, 일관된 조작 위치 | 동일 과제의 완료 시간·잘못 누른 횟수·도움 요청 비교 |
| 통제와 회복 | 생성 중·검토 대기·반영됨·실패를 구분, 취소·재시도·복원 안내 | 실제 상태 전환과 실패 복구 시나리오 |
| 접근성 | 키보드 이동, 보이는 포커스, 적절한 이름·역할·상태, 누르기 쉬운 표적 | axe 자동 검사 + 직접 키보드·화면 읽기 검수 |
| 시각적 일관성 | 의미에 따른 색·간격·글자·모서리·상태 값과 공통 컴포넌트 | 상태별 컴포넌트 비교와 화면 시각 회귀 |

일반 텍스트는 WCAG AA 대비 4.5:1을 기준으로 삼는다. 큰 텍스트는 3:1이며 14px 텍스트는 일반 텍스트에 해당한다. 클릭 표적의 WCAG 2.2 AA 기준은 예외 조건을 포함한 24×24 CSS px다. 이 제품의 중요한 버튼은 사용 편의를 위해 36~44px 높이를 설계 목표로 제안한다. 이는 WCAG가 모든 버튼에 44px를 요구한다는 뜻이 아니다. [W3C 대비](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html), [W3C 표적 크기](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)

## 현재 앱에서 확인한 우선 개선점

| 우선순위 | 근거 | 개선안 |
|---|---|---|
| P1 글자 크기와 대비 | 실제 대시보드 메뉴 12px, 카드 설명 11px, 수정일 10px, 검색 입력 11px. root 14px가 개별 선언으로 덮임 | 본문·입력·주요 조작 14px, 보조 정보 12~13px를 시작안으로 삼고 한글 화면에서 검토. 크기와 대비를 함께 개선 |
| P1 편집 공간 | AI 패널 기본 432px, PRD 목차 225px, 레일 61px. 1050px 이하에서도 AI inline 폭이 유지될 수 있음 | 화면 전체 폭보다 문서의 남은 폭을 기준으로 보조 패널 접기/오버레이 전환. 970·1280·1440px에서 실제 검증 |
| P1 AI 변경 검토 | 비교 본문 11px, 낮은 대비, 고정 2열, 긴 내용 뒤 승인 영역 | 변경·삭제 수와 적용 버전 요약, 고정 승인 영역, 선택 개수 표시, 좁은 화면에서 세로 비교 |
| P2 탐색 구조 | 레일과 상단 탭에 같은 4개 문서 목적지 반복 | 전역 이동과 현재 문서 이동의 역할을 명확히 하고 사용자 과제로 효율 비교 |
| P2 공통 상호작용 | 탭의 키보드 패턴, 카드 안 메뉴, 서식 활성 상태 등 구현이 분산 | Tabs/Menu/Toolbar/Dialog의 접근성 패턴과 상태를 공통화 |

코드 근거: [스타일](../src/styles.css), [AI 패널 배치](../src/components/AiPanelFrame.tsx), [AI 승인](../src/components/AiPanel.tsx), [탐색](../src/App.tsx), [대시보드](../src/Dashboard.tsx), [서식 도구](../src/components/RichEditor.tsx).

CSS에 명시된 전경/배경 색상쌍의 대비를 계산했다. 이는 해당 색상쌍의 결과이며 전체 앱의 접근성 점수나 모든 화면에서의 실측 결과가 아니다.

| 대상 | 전경 / 배경 | 계산 대비 |
|---|---|---:|
| 프로젝트 설명 | `#a19bac` / `#ffffff` | 2.69:1 |
| 저장 상태 | `#aaa4b7` / `#ffffff` | 2.41:1 |
| AI 제안 현재 내용 | `#af9197` / `#fff8f8` | 2.74:1 |
| AI 제안 변경 후 | `#7d9e85` / `#f4fbf5` | 2.81:1 |
| PRD 본문 | `#67616f` / `#ffffff` | 5.97:1 |

## 디자인 에이전트 스킬 후보

공식 저장소, README, 실제 SKILL, 라이선스 표기를 확인했다. 아래 평가는 프로젝트에 대한 적합성 판단이며 성능 순위나 사용자 평가 결과가 아니다.

| 후보 | 용도 | 권고 | 라이선스 |
|---|---|---|---|
| [Vercel Web Design Guidelines](https://github.com/vercel-labs/agent-skills/blob/main/skills/web-design-guidelines/SKILL.md) | 접근성·포커스·입력·피드백·탐색 등 코드 감사 | 우선 도입. 반복 검수의 체크리스트로 사용 | 저장소 MIT |
| [Impeccable](https://github.com/pbakaus/impeccable) | 위계·배치·밀도·문구 비평과 개선 | 디자인 개선 후보 1순위. 업무 앱용 Operate 모드에 맞춰 사용 | Apache-2.0 |
| [Anthropic frontend-design](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md) | 시각적 방향·타이포·레이아웃 시안 | 가벼운 시안 탐색 대안. Impeccable와 역할을 겹쳐 실행하지 않음 | 개별 스킬 Apache-2.0 |
| [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) | 스타일·색·타이포·UX 규칙과 스택별 참고 자료 검색 | 보조 사전으로 활용. 프로젝트 맥락과 실제 검증이 추천 기본값보다 우선 | MIT |

Vercel 스킬은 외부의 최신 [검토 규칙](https://github.com/vercel-labs/web-interface-guidelines/blob/main/command.md)을 가져오는 코드 리뷰 지침이다. 화면을 설계하거나 브라우저에서 동작을 증명하는 도구는 아니다. 재현을 위해 실행 시 사용한 커밋 또는 규칙 버전을 기록한다.

Impeccable의 [실제 스킬](https://github.com/pbakaus/impeccable/blob/main/.agents/skills/impeccable/SKILL.md)과 [비평 절차](https://github.com/pbakaus/impeccable/blob/main/.agents/skills/impeccable/reference/critique.md)는 작업 맥락과 기존 브리프를 반영하며, 디자인 판단과 검출 도구의 증거를 구분한다. 현재 기본 설치는 엔진 실행용 런처와 Codex hook 설정을 추가하며, 엔진 바이너리는 동봉되거나 최초 실행 시 다운로드될 수 있다. 브라우저 overlay의 스크립트 주입 경로는 현재 CUA의 읽기 전용 evaluate에서 작동한다고 확인하지 않았다. 따라서 완전한 자동 loop가 바로 지원된다고 전제하지 않고, 도입 시 공식 설치 범위·Windows 실행·브라우저 연결을 확인한다. 디자인 점수는 UAT 성공률을 의미하지 않는다.

Anthropic 후보는 [개별 라이선스](https://github.com/anthropics/skills/blob/main/skills/frontend-design/LICENSE.txt)를 확인했다. UI UX Pro Max의 공식 저장소는 `nextlevelbuilder/ui-ux-pro-max-skill`이며, 현재 README의 CLI 이름은 `ui-ux-pro-max-cli`다. Python 3 기반 로컬 검색을 제공한다. 기본 크기 추천이 사용자 지정과 다를 경우 이 프로젝트의 Pretendard 14px 요구를 우선한다.

현재 제공된 스킬 중 REA는 원본 동작·구조 분석에, Figma 관련 스킬은 디자인 파일 작업에 활용할 수 있다. 이번에 찾은 후보는 디자인 판단과 검수의 보완재다. 스킬을 설치하는 것과 실제 프로젝트에서 효과를 확인하는 것은 별도 단계다.

## 구현·검수용 오픈소스 후보

| 후보 | 프로젝트 적용 | 비용·제약 | 권고 |
|---|---|---|---|
| [Radix Primitives](https://www.radix-ui.com/primitives/docs/overview/introduction) | Dialog·Tabs·Dropdown 등 접근성 동작의 공통 기반 | 화면 스타일은 직접 설계. 점진 교체 후 키보드·포커스 회귀 확인 | 구현 기반 우선 후보 |
| [React Aria](https://react-aria.adobe.com/quality) | 복잡한 선택·입력·국제화 UI의 대안 | 별도 API 학습과 통합. Radix와 중복되는 공통 부품을 두 체계로 만들지 않음 | 필요 시 대안 |
| [shadcn/ui](https://ui.shadcn.com/docs) | 수정 가능한 컴포넌트 소스와 패턴 참고 | 현재 [Vite 설치](https://ui.shadcn.com/docs/installation/vite)는 Tailwind 추가를 안내. 기존 CSS와 reset·토큰·상태 규칙 조정 필요 | 패턴 참고, 전면 전환은 후순위 |
| [Storybook](https://storybook.js.org/docs/writing-tests/accessibility-testing) | 기본·호버·포커스·비활성·오류·긴 한글 상태를 모아서 검수 | 개발 도구 설정 및 stories 유지 비용 | 공통 부품 정리와 함께 점진 도입 |
| [axe-core](https://github.com/dequelabs/axe-core) + [Playwright](https://playwright.dev/docs/accessibility-testing) | 실행된 화면의 접근성 검사와 사용자 흐름 검증 | 자동 검사는 일부 문제만 탐지 | 기존 E2E에 우선 추가 |
| [Playwright 시각 비교](https://playwright.dev/docs/test-snapshots) | 핵심 화면의 캡처와 기준 이미지 차이 검사 | 글꼴·OS·뷰포트·데이터를 고정하고 변경을 사람이 검토 | 현재 검수 loop 확장 |

Radix는 현재 CSS로 스타일을 입힐 수 있어 이 프로젝트에 도입 부담이 작다고 판단한다. [공식 스타일 가이드](https://www.radix-ui.com/primitives/docs/guides/styling). 현재 Tiptap·React Flow·Lucide는 각각 편집기·캔버스·아이콘 역할을 이미 담당한다. 추가 UI 도구는 이들의 주변 공통 조작부터 적용하는 편이 적절하다.

저장소 표기 기준으로 [Radix](https://github.com/radix-ui/primitives), [shadcn/ui](https://github.com/shadcn-ui/ui), [Storybook](https://github.com/storybookjs/storybook)은 MIT, [axe-core](https://github.com/dequelabs/axe-core)는 MPL-2.0이다. 설치 단계에서는 선택한 실제 패키지 버전과 라이선스를 다시 기록한다. 오픈소스 저장소와 별도의 유료 호스팅·검수 서비스는 구분한다.

## 권장 실행 순서와 검수 loop

1. **설계 기준과 기준 화면 기록**: `DESIGN.md`에 사용 목적·대상·주요 과제·Pretendard 14px·색/간격/상태 토큰·금지할 퇴행을 정의한다. 현재 화면과 과제 완료 시간을 먼저 측정한다.
2. **가독성과 공통 부품**: 본문/입력/버튼 크기·대비, Button·TextField·Tabs·Menu·Dialog를 정리한다. 디자인 개선 스킬 한 개로 제안하고 Vercel 기준으로 코드 검토한다.
3. **핵심 작업 화면**: PRD 편집 공간, AI 검토 대화상자, 플로우·와이어프레임 도구 영역을 작업별로 개선한다. 대시보드는 다음 작업을 쉽게 찾도록 정리한다.
4. **브라우저 검수**: 970·1280·1440px, AI 도킹/분리/접힘, 긴 한글·빈 상태·로딩·실패·승인 대기·반영 완료를 확인한다. 200% 확대와 키보드만으로 주요 과제를 수행한다. 캔버스의 의도된 이동과 문서/폼의 불필요한 가로 스크롤을 구분한다.
5. **사용자 과제 검증**: 새 PRD 작성, AI 제안 비교·일부 승인, 특정 버전의 화면 복원 과제를 수행한다. 완료 여부·시간·오조작·도움 요청과 사용자의 설명을 기록한다. 사용자 최종 인수는 에이전트 검수와 별도로 기록한다.

loop는 **관찰 → 문제와 목표 정의 → 작은 변경 → 코드/접근성/시각 검사 → 실제 과제 수행 → 남은 문제 재정렬**로 운영한다. 완료 기준은 주요 동작 회귀 없음, 중요 접근성 결함 해결, 읽을 수 있는 대비, 좁은 창에서도 주요 조작 접근 가능, 승인 전후와 적용 버전 식별 가능이다. 사용자 과제 지표는 기준 측정 전 개선율을 제시하지 않는다.

반복 상태 검사는 고정 fixture로 수행하고 AI 처리 자체를 수정한 경우에는 합성 데이터와 제한된 요청으로 실제 Groq 경로를 추가 검증한다. 모의·실연동·직접 브라우저 검수 결과를 각각 표시한다. 원본 서비스 생성은 디자인 개선 반복 검수에 필요하지 않다. 자동 접근성 검사만으로 품질을 보증할 수 없다는 제한은 [Playwright 공식 지침](https://playwright.dev/docs/accessibility-testing)과도 일치한다.

즉시 시작할 최소 조합은 **Vercel Web Design Guidelines + frontend-design 설계 참고 + 기존 CSS 토큰 + Playwright/axe**다. 공통 UI 정비에는 Radix와 Storybook을 점진 도입하고, 반복 디자인 개선을 확대할 때 Impeccable의 런처·hook·Windows 및 브라우저 지원을 확인해 추가한다. 첫 개선 범위는 **글자·대비 → 편집 공간 → AI 변경 검토**로 잡는다.
