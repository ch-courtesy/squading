# 게임 제안서 모음

《뱀파이어 서바이벌》의 짧고 강한 자동 전투 생존 루프와 《퍼스트 퀸 4》의 두 부대·간접 지휘·피로·구조 시스템을 연구해 만든 의사결정용 문서다. 원작의 고유 명칭, 세계관, 캐릭터, 아트, UI는 사용하지 않는다.

## 리서치

- [뱀파이어 서바이벌 분석](research/vampire-survivors.md)
- [퍼스트 퀸 4 분석](research/first-queen-4.md)

## 게임 콘셉트

- [두 분대 전장 생존 로그라이트](concepts/two-squad-survival-roguelite.md)

## 아트 방향

1. [먹빛 전쟁 연대기](art/01-ink-war-chronicle.md)
2. [네온 전술 홀로그램](art/02-neon-tactical-hologram.md)
3. [장난감 전쟁 디오라마](art/03-tabletop-war-diorama.md)
4. [스테인드글라스 종말전쟁](art/04-stained-glass-apocalypse.md)
5. [32비트 전쟁 군상극](art/05-32bit-war-chronicle.md)
6. [아트 비교표와 이미지 생성 명세](art/README.md)

## 기술 방향

1. [Phaser 3 + TypeScript](technology/01-phaser-typescript.md)
2. [PixiJS + 자체 게임 루프](technology/02-pixijs-custom-loop.md)
3. [Godot 4 Web Export](technology/03-godot-web.md)
4. [Three.js 2.5D 디오라마](technology/04-threejs-diorama.md)
5. [기술 비교와 권장 구성](technology/README.md)

## 현재 추천 조합

- 게임: 두 AI 분대를 교대 지휘하는 8~12분 전장 생존 로그라이트
- 아트: 장난감 전쟁 디오라마
- 기술 선택 방식: 공유 전투 코어에 2D·2.5D·3D 렌더러를 연결한 비교 프로토타입으로 결정
- MVP: 지휘관 1명, 두 분대 16~24명, 적 최대 약 300명, 전투 1개, 성장 선택 3~4회

비교 프로토타입의 상세 구조와 선택 규칙은 [테이블탑 3렌더러 비교 프로토타입 설계](../superpowers/specs/2026-08-12-tabletop-renderer-comparison-design.md)에 기록한다.
