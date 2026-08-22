// `core/campaign-view/` — the display-only projection of a campaign (§6, campaign §5 stage 1).
//
// It sits BESIDE `core/campaign/`, never inside it, and the dependency runs one way, exactly as
// `core/battle-view/` sits beside `core/battle/`. One projection, because there is one question:
// what the transition and end screens print.
//
// It reads `core/battle-view/hud.ts` for the card labels, so a card's magnitude is written once
// and both screens quote the same number.

export * from './hud'
