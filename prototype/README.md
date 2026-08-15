# Tabletop Renderer Comparison Prototype

동일한 분대 생존 전투를 Phaser 2D, Three.js 2.5D, Three.js 3D로 비교하기 위한 브라우저 프로토타입이다. 세 렌더러 모두 실제 동적 import로 로드되는 플레이 가능한 브라우저 디오라마이며, 3D는 외부 에셋 없이 코드 생성 저폴리 `InstancedMesh` 미니어처를 사용한다.

## 로컬 실행

로컬 검증은 Node.js 22.14.0과 npm 10.9.2를 사용했다. GitHub Actions는 Node.js 22.22.2를 사용한다.

```bash
npm ci
npx playwright install chromium
npm run dev
```

검증 명령은 다음과 같다.

```bash
npm run build
npm run test
npm run test:e2e
```

Pages 하위 경로를 포함한 프로덕션 산출물은 빌드 뒤 `npm run preview:pages`로 검증한다.

`npm run build`는 GitHub Actions의 `GITHUB_REPOSITORY`에서 저장소 이름을 읽어 `/<repository>/` base 경로를 만든다. 사용자·조직 Pages 저장소(`*.github.io`)는 `/`를 사용한다. 다른 정적 호스팅 경로는 `VITE_BASE_PATH=/원하는/경로/ npm run build`로 재정의할 수 있다.

## 고정한 안정 버전

2026-08-13에 npm `latest` dist-tag를 조회해 프리릴리스가 아닌 아래 버전을 정확히 잠갔다. 재현 가능한 설치는 `package-lock.json`과 `npm ci`를 사용한다.

| 패키지 | 버전 | 선택 근거 |
|---|---:|---|
| Vite | 8.2.1 | `latest`; Node 22.12 이상 지원 |
| TypeScript | 7.0.2 | `latest` |
| Vitest | 4.1.10 | `latest`; Node 22 지원 |
| jsdom | 29.1.1 | 안정 릴리스이며 현재 Node 22.14 지원. `latest` 30.0.1은 Node 22.22.2 이상 필요 |
| Playwright | 1.62.1 | `latest`; Chromium E2E |
| Phaser | 4.2.1 | `latest`가 안정 Phaser 4이므로 선택 |
| Three.js | 0.185.1 | `latest`; 2.5D WebGL renderer |
| @types/three | 0.185.4 | Three.js 0.185 TypeScript declarations |
| @types/node | 22.x | 실행 Node 22와 같은 major |

Phaser 4.2.1과 Three.js 0.185.1은 각각의 renderer 선택 시에만 동적 import되며, package-lock과 같은 정확한 버전으로 설치된다. Three.js 2.5D는 orthographic camera, 코드 생성 골판지 mesh/material, billboard 병사와 제한된 shadow map을 사용한다. WebGL을 사용할 수 없으면 앱은 기존 2D 선택으로 안전하게 복구한다.

## GitHub Pages

`.github/workflows/deploy-prototype.yml`은 `main` push 또는 수동 실행 시 `prototype/dist`를 GitHub Pages artifact로 배포한다. 저장소 Settings → Pages의 Source를 **GitHub Actions**로 설정해야 한다. 저장소 생성, 원격 연결, push와 최초 Pages 활성화는 외부 상태 변경이므로 사용자 승인 후 수행한다.

## URL 계약

다음 쿼리로 비교 조건을 재현한다.

```text
?renderer=2d|hybrid|3d&enemies=100|200|300&seed=...
```

유효하지 않거나 비어 있는 값은 `renderer=2d`, `enemies=100`, `seed=tabletop-001`로 안전하게 복구한다.
