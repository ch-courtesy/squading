// §3.2: "캠페인도 결정론적이어야 한다." The seed derivation and the campaign digest.

import { describe, expect, it } from 'vitest'

import { createBattle } from '../../src/core/battle/battle'
import { policyFactory } from '../../src/core/harness/policy/policies'
import { projectPolicyView } from '../../src/core/harness/policy/view'
import { COMBAT_TICK_LIMIT } from '../../src/core/battle/constants'
import { FIRST_STAGE_ID } from '../../src/core/battle/stages'
import { createCampaign } from '../../src/core/campaign/campaign'
import {
  canonicalizeCampaignState,
  digestCampaignState,
} from '../../src/core/campaign/digest'
import { stageSeed } from '../../src/core/campaign/seed'
import { createCampaignState, type CampaignState } from '../../src/core/campaign/state'

/** Play the campaign in front of us to its end, one policy driving every stage of it. */
function playCampaign(rootSeed: string, policyId: 'skilled' | 'tactical-no-input') {
  const campaign = createCampaign(rootSeed)
  for (let stage = 0; stage < 8; stage += 1) {
    const battle = campaign.battle()
    const policy = policyFactory(policyId)(rootSeed)
    battle.start()
    let steps = 0
    while (battle.mode() !== 'won' && battle.mode() !== 'lost') {
      if (steps >= COMBAT_TICK_LIMIT * 2) throw new Error('campaign fixture: stage did not decide')
      for (const command of policy.decide(projectPolicyView(battle.state()))) battle.enqueue(command)
      battle.step()
      steps += 1
    }
    campaign.finishStage()
    if (campaign.state().phase !== 'stage-cleared') break
    campaign.advance()
  }
  return campaign
}

describe('§3.2 stage seeds derive from the campaign root', () => {
  it('gives the first stage the root itself, so `createBattle(s)` IS stage 1 of campaign s', () => {
    expect(stageSeed('seed-a', FIRST_STAGE_ID)).toBe('seed-a')
    const campaign = createCampaign('seed-a')
    expect(campaign.battle().seed()).toBe('seed-a')
    expect(campaign.battle().digest()).toBe(createBattle('seed-a').digest())
  })

  it('is a pure function of the root and the stage number', () => {
    expect(stageSeed('seed-a', FIRST_STAGE_ID)).toBe(stageSeed('seed-a', FIRST_STAGE_ID))
    expect(stageSeed('seed-a', FIRST_STAGE_ID)).not.toBe(stageSeed('seed-b', FIRST_STAGE_ID))
  })

  it('advances no PRNG stream to produce a seed', () => {
    // §1.17 names three streams and the campaign adds none: the derivation is string arithmetic,
    // so a stage's seed can be computed without a battle existing and without moving one.
    const before = createCampaign('seed-a').battle().state().prng
    expect(stageSeed('seed-a', FIRST_STAGE_ID)).toBe('seed-a')
    expect(createCampaign('seed-a').battle().state().prng).toEqual(before)
    expect(Object.keys(before).sort()).toEqual(['cards', 'names', 'spawn'])
  })
})

describe('§3.2 the campaign digest', () => {
  it('replays a whole campaign from the same root seed', () => {
    const left = playCampaign('seed-a', 'skilled')
    const right = playCampaign('seed-a', 'skilled')

    expect(left.state()).toEqual(right.state())
    expect(left.digest()).toBe(right.digest())
    // And it is a campaign that actually happened, not an empty one that trivially matches.
    expect(left.state().phase).toBe('campaign-over')
    expect(left.state().kills).toBeGreaterThan(0)
  })

  it('separates two campaigns that differ only in root seed', () => {
    expect(playCampaign('seed-a', 'skilled').digest()).not.toBe(
      playCampaign('seed-b', 'skilled').digest(),
    )
  })

  it('separates a campaign that was won from one that was lost', () => {
    const won = playCampaign('seed-a', 'skilled')
    const lost = playCampaign('seed-a', 'tactical-no-input')
    expect(won.state().end).toBe('complete')
    expect(lost.state().end).toBe('defeat')
    expect(won.digest()).not.toBe(lost.digest())
  })

  it('watches every field of `CampaignState`', () => {
    const base = createCampaignState('root-a')
    base.squad = {
      commandUnitId: 1,
      members: [{ id: 1, role: 'commander', nameIndex: 3, hp: 4, maxHp: 5 }],
    }
    base.fallen = [{ id: 9, nameIndex: 11, stageId: 1 }]
    base.cards = ['firepower']
    base.kills = 20

    type Mutation = [string, (state: CampaignState) => void]
    const fields: Mutation[] = [
      ['schemaVersion', (s) => void ((s as { schemaVersion: number }).schemaVersion = 2)],
      ['rootSeed', (s) => void (s.rootSeed = 'other')],
      ['phase', (s) => void (s.phase = 'campaign-over')],
      ['end', (s) => void (s.end = 'defeat')],
      ['kills', (s) => void (s.kills = 21)],
      ['cards', (s) => void s.cards.push('cover')],
      ['fallen.nameIndex', (s) => void (s.fallen[0].nameIndex = 12)],
      ['fallen.id', (s) => void (s.fallen[0].id = 10)],
      ['fallen.stageId', (s) => void (s.fallen[0].stageId = 1 as const)],
      ['squad.commandUnitId', (s) => void (s.squad!.commandUnitId = 2)],
      ['squad.member.hp', (s) => void (s.squad!.members[0].hp = 4.5)],
      ['squad.member.maxHp', (s) => void (s.squad!.members[0].maxHp = 6)],
      ['squad.member.nameIndex', (s) => void (s.squad!.members[0].nameIndex = 4)],
      ['squad.member.role', (s) => void (s.squad!.members[0].role = 'soldier')],
      ['squad.member.id', (s) => void (s.squad!.members[0].id = 2)],
      ['squad emptied', (s) => void (s.squad = null)],
    ]

    const baseline = digestCampaignState(base)
    const seen = new Set<string>([baseline])
    for (const [label, mutate] of fields) {
      const state = structuredClone(base)
      mutate(state)
      const digest = digestCampaignState(state)
      // `fallen.stageId` is set to the value it already had: with one stage in the table there is
      // no second value to move it to, so this row asserts NOTHING and says so rather than
      // pretending. §5 stage 2 is what makes it a real mutation.
      if (label === 'fallen.stageId') {
        expect(digest).toBe(baseline)
        continue
      }
      expect(digest, `the campaign digest ignored ${label}`).not.toBe(baseline)
      seen.add(digest)
    }
    expect(seen.size).toBe(fields.length)
  })

  it('is insensitive to array order but not to content', () => {
    const base = createCampaignState('root-a')
    base.fallen = [
      { id: 4, nameIndex: 1, stageId: 1 },
      { id: 9, nameIndex: 2, stageId: 1 },
    ]
    base.squad = {
      commandUnitId: 1,
      members: [
        { id: 1, role: 'commander', nameIndex: 3, hp: 5, maxHp: 5 },
        { id: 2, role: 'soldier', nameIndex: 4, hp: 1.4, maxHp: 1.4 },
      ],
    }
    const shuffled = structuredClone(base)
    shuffled.fallen.reverse()
    shuffled.squad!.members.reverse()

    expect(digestCampaignState(shuffled)).toBe(digestCampaignState(base))

    // The CARD order is data, not bookkeeping: §1.2 allows each card once, so the list is the
    // order they were taken in and reversing it is a different campaign history.
    const reordered = structuredClone(base)
    reordered.cards = ['firepower', 'cover']
    const other = structuredClone(reordered)
    other.cards = ['cover', 'firepower']
    expect(digestCampaignState(other)).not.toBe(digestCampaignState(reordered))
  })

  it('canonicalizes to sorted keys', () => {
    const canonical = canonicalizeCampaignState(createCampaignState('root-a')) as Record<
      string,
      unknown
    >
    expect(Object.keys(canonical)).toEqual([...Object.keys(canonical)].sort())
    expect(canonical.rootSeed).toBe('root-a')
    expect(canonical.schemaVersion).toBe(1)
  })
})

describe('the campaign facade', () => {
  it('restarts at stage 1 with a squad nobody has spent (§1.4)', () => {
    const campaign = playCampaign('seed-a', 'tactical-no-input')
    expect(campaign.state().phase).toBe('campaign-over')

    campaign.restart()

    expect(campaign.state()).toEqual(createCampaignState('seed-a'))
    expect(campaign.battle().state().friendlies).toHaveLength(16)
    expect(campaign.battle().state().combatTick).toBe(0)
    expect(campaign.digest()).toBe(digestCampaignState(createCampaignState('seed-a')))
  })

  it('restarts onto another root seed when given one', () => {
    const campaign = createCampaign('seed-a')
    campaign.restart('seed-b')
    expect(campaign.rootSeed()).toBe('seed-b')
    expect(campaign.battle().seed()).toBe('seed-b')
  })

  it('refuses to fold a stage that is still running', () => {
    const campaign = createCampaign('seed-a')
    campaign.battle().start()
    campaign.battle().step()
    expect(() => campaign.finishStage()).toThrow(/has not ended/)
  })
})
