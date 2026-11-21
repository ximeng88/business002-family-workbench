/**
 * 兑换申请 / 审核测试（M2 + M5）。
 *
 * 环境：fake-indexeddb。重点验证：
 * - 申请不扣分、不写流水，同一孩子同时最多一批 pending；
 * - **一次可提交多件**，共用 batchId，合计不够整批挡回（不生成 pending、不占名额）；
 * - 确认在一个事务里完成余额复核 + 逐件负向流水 + 状态更新（装扮再加收藏）；
 * - 重复确认零重复扣分、零重复收藏（幂等键 `redemption:${id}`）；
 * - **部分勾选**时未勾选的件在同一事务里退回，不留悬挂 pending；
 * - 申请后星星被花掉时，确认整批回滚，**零写入**；
 * - 扣分只认申请快照，家长之后改价不影响既有申请。
 */

import "fake-indexeddb/auto"
import test from "node:test"
import assert from "node:assert/strict"
import Dexie from "dexie"

import { closeDb, getDb, openDatabase } from "../src/db/database.js"
import { DB_NAME } from "../src/db/schema.js"
import { DB_ERROR_CODES } from "../src/db/errors.js"
import { adjustPoints, getBalance } from "../src/services/points.service.js"
import { ensureBuiltinRewardConfigs, updateReward } from "../src/services/reward.service.js"
import {
  acceptRedemption,
  acceptRedemptionBatch,
  listRedemptionRequests,
  listRedemptionsByChild,
  MAX_BATCH_ITEMS,
  redemptionEventKey,
  rejectRedemption,
  rejectRedemptionBatch,
  requestRedemption,
  requestRedemptions,
} from "../src/services/redemption.service.js"
import { ensureSeedData, M0_CHILD_ID } from "../src/services/task.service.js"

async function useCleanDatabase(t) {
  closeDb()
  await Dexie.delete(DB_NAME)
  await openDatabase()
  await ensureSeedData()
  await ensureBuiltinRewardConfigs()
  t.after(async () => {
    closeDb()
    await Dexie.delete(DB_NAME)
  })
}

async function fund(points = 100) {
  return adjustPoints({ childId: M0_CHILD_ID, delta: points, reason: "测试充值" })
}

test("M2-RD1 申请写快照但不扣分，同孩子只能有一条 pending", async (t) => {
  await useCleanDatabase(t)
  await fund(100)
  const before = await getBalance(M0_CHILD_ID)

  const request = await requestRedemption({ childId: M0_CHILD_ID, rewardId: "rw_costume_hat_straw" })
  assert.equal(request.status, "pending")
  assert.equal(request.rewardNameSnapshot, "小草帽")
  assert.equal(request.costSnapshot, 20)
  assert.equal(request.categorySnapshot, "costume")
  assert.equal(request.costumeKeySnapshot, "hat_straw")
  assert.equal(request.assetKeySnapshot, "costume_hat_straw")
  assert.ok(request.requestedAt)

  const after = await getBalance(M0_CHILD_ID)
  assert.equal(after.balance, before.balance, "申请不能扣分")
  assert.equal(after.entryCount, before.entryCount, "申请不能写流水")

  await assert.rejects(
    () => requestRedemption({ childId: M0_CHILD_ID, rewardId: "rw_life_play15" }),
    (error) => error.code === DB_ERROR_CODES.VALIDATION_FAILED,
  )
  assert.equal((await listRedemptionsByChild(M0_CHILD_ID)).length, 1)
})

test("M2-RD2 确认扣分恰好一次，重复确认返回 duplicate", async (t) => {
  await useCleanDatabase(t)
  await fund(100)
  const request = await requestRedemption({ childId: M0_CHILD_ID, rewardId: "rw_life_park" })

  const result = await acceptRedemption({ redemptionId: request.id })
  assert.equal(result.status, "accepted")
  assert.equal(result.cost, 50)
  assert.equal(result.balanceBefore, 100)
  assert.equal(result.balanceAfter, 50)

  const ledger = await getDb().pointLedger.where("eventKey").equals(redemptionEventKey(request.id)).toArray()
  assert.equal(ledger.length, 1)
  assert.equal(ledger[0].delta, -50)
  assert.equal(ledger[0].source, "redeem")
  assert.equal(ledger[0].redemptionId, request.id)
  assert.equal(Object.hasOwn(ledger[0], "approvalDate"), false, "兑换不算当天学习完成")

  const again = await acceptRedemption({ redemptionId: request.id })
  assert.equal(again.status, "duplicate")
  assert.equal(await getDb().pointLedger.where("eventKey").equals(redemptionEventKey(request.id)).count(), 1)
  assert.equal((await getBalance(M0_CHILD_ID)).balance, 50)

  const stored = await getDb().redemptions.get(request.id)
  assert.equal(stored.status, "accepted")
  assert.ok(stored.handledAt)
})

test("M2-RD3 星星不够：申请直接被挡回，不生成 pending、不占名额、不写流水", async (t) => {
  await useCleanDatabase(t)
  await fund(10) // 不够 50
  const ledgerBefore = await getDb().pointLedger.count()

  await assert.rejects(
    () => requestRedemption({ childId: M0_CHILD_ID, rewardId: "rw_life_park" }),
    (error) =>
      error.code === DB_ERROR_CODES.VALIDATION_FAILED &&
      /还差 40 颗星星/.test(error.message) &&
      error.context?.shortage === 40,
    "余额不足必须在申请阶段就拒绝，并告诉孩子还差多少",
  )

  assert.equal(await getDb().redemptions.count(), 0, "不能留下任何 pending")
  assert.equal(await getDb().pointLedger.count(), ledgerBefore, "被挡回不能写流水")
  assert.equal((await getBalance(M0_CHILD_ID)).balance, 10, "余额不变")
  assert.equal(await getDb().petCostumeOwnerships.count(), 0)

  // 挡回不占"同时一条 pending"的名额：攒够之后还能正常申请
  await fund(40)
  const ok = await requestRedemption({ childId: M0_CHILD_ID, rewardId: "rw_life_park" })
  assert.equal(ok.status, "pending")
})

test("M2-RD3B 申请后星星被花掉：确认被拒绝且零写入", async (t) => {
  await useCleanDatabase(t)
  await fund(100)
  const request = await requestRedemption({ childId: M0_CHILD_ID, rewardId: "rw_life_park" })
  // 申请之后星星被别处花掉，家长确认时余额已不够——这层兜底仍然必须有效
  await adjustPoints({ childId: M0_CHILD_ID, delta: -95, reason: "测试消耗" })
  const ledgerBefore = await getDb().pointLedger.count()

  await assert.rejects(
    () => acceptRedemption({ redemptionId: request.id }),
    (error) =>
      error.code === DB_ERROR_CODES.VALIDATION_FAILED && /星星不够/.test(error.message),
  )

  const stored = await getDb().redemptions.get(request.id)
  assert.equal(stored.status, "pending", "失败必须整笔回滚，申请不能变成 accepted")
  assert.equal(await getDb().pointLedger.count(), ledgerBefore, "失败不能留下任何流水")
  assert.equal((await getBalance(M0_CHILD_ID)).balance, 5)
  assert.equal(await getDb().petCostumeOwnerships.count(), 0)
})

test("M2-RD4 扣分只认申请快照，家长之后改价不影响", async (t) => {
  await useCleanDatabase(t)
  await fund(100)
  const request = await requestRedemption({ childId: M0_CHILD_ID, rewardId: "rw_costume_hat_straw" })
  assert.equal(request.costSnapshot, 20)

  // 家长把帽子从 20 改成 90
  await updateReward({ rewardId: "rw_costume_hat_straw", cost: 90 })

  const result = await acceptRedemption({ redemptionId: request.id })
  assert.equal(result.cost, 20, "按快照扣分，不按当前价")
  assert.equal((await getBalance(M0_CHILD_ID)).balance, 80)
})

test("M2-RD5 拒绝不扣分且是终态", async (t) => {
  await useCleanDatabase(t)
  await fund(30)
  const request = await requestRedemption({ childId: M0_CHILD_ID, rewardId: "rw_life_play15" })

  const rejected = await rejectRedemption({ redemptionId: request.id, parentMessage: "这周先攒着" })
  assert.equal(rejected.status, "rejected")
  assert.equal((await getBalance(M0_CHILD_ID)).balance, 30, "拒绝不能扣分")
  assert.equal(await getDb().pointLedger.where("source").equals("redeem").count(), 0)

  await assert.rejects(
    () => acceptRedemption({ redemptionId: request.id }),
    (error) => error.code === DB_ERROR_CODES.VALIDATION_FAILED,
  )
  // 重复拒绝按幂等处理，不重复写
  const again = await rejectRedemption({ redemptionId: request.id })
  assert.equal(again.status, "duplicate")

  // 终态释放了 pending 名额，可以再申请一条
  const next = await requestRedemption({ childId: M0_CHILD_ID, rewardId: "rw_life_cartoon" })
  assert.equal(next.status, "pending")
})

test("M2-RD6 装扮确认写收藏，且不重复收藏", async (t) => {
  await useCleanDatabase(t)
  await fund(100)
  const request = await requestRedemption({ childId: M0_CHILD_ID, rewardId: "rw_costume_hat_straw" })

  const result = await acceptRedemption({ redemptionId: request.id })
  assert.equal(result.status, "accepted")
  assert.ok(result.ownershipId)

  const owned = await getDb().petCostumeOwnerships.toArray()
  assert.equal(owned.length, 1)
  assert.equal(owned[0].childId, M0_CHILD_ID)
  assert.equal(owned[0].costumeKey, "hat_straw")
  assert.equal(owned[0].sourceRedemptionId, request.id)

  await acceptRedemption({ redemptionId: request.id })
  assert.equal(await getDb().petCostumeOwnerships.count(), 1, "重复确认不能重复到账")

  // 已拥有的装扮不能再申请
  await fund(100)
  await assert.rejects(
    () => requestRedemption({ childId: M0_CHILD_ID, rewardId: "rw_costume_hat_straw" }),
    (error) => error.code === DB_ERROR_CODES.VALIDATION_FAILED,
  )
})

test("M2-RD7 停用奖励不能申请，但既有 pending 仍可确认", async (t) => {
  await useCleanDatabase(t)
  await fund(100)
  const request = await requestRedemption({ childId: M0_CHILD_ID, rewardId: "rw_life_gift" })

  const { setRewardEnabled } = await import("../src/services/reward.service.js")
  await setRewardEnabled({ rewardId: "rw_life_gift", enabled: false })

  // 既有申请照常可确认（快照有效）
  const result = await acceptRedemption({ redemptionId: request.id })
  assert.equal(result.status, "accepted")
  assert.equal(result.cost, 60)

  // 新申请被拒
  await assert.rejects(
    () => requestRedemption({ childId: M0_CHILD_ID, rewardId: "rw_life_gift" }),
    (error) => error.code === DB_ERROR_CODES.VALIDATION_FAILED,
  )
})

test("M2-RD8 并发确认：只扣一次分，只写一条流水", async (t) => {
  await useCleanDatabase(t)
  await fund(100)
  const request = await requestRedemption({ childId: M0_CHILD_ID, rewardId: "rw_life_park" })

  // fake-indexeddb 会把重叠事务串行化；无论谁先到，结果都必须是"只扣一次"
  const settled = await Promise.allSettled([
    acceptRedemption({ redemptionId: request.id }),
    acceptRedemption({ redemptionId: request.id }),
  ])

  const accepted = settled.filter((item) => item.status === "fulfilled" && item.value.status === "accepted")
  const duplicates = settled.filter((item) => item.status === "fulfilled" && item.value.status === "duplicate")
  assert.equal(accepted.length, 1, "只能有一次真正扣分")
  assert.equal(duplicates.length, 1, "另一次必须被认成重复")

  assert.equal(await getDb().pointLedger.where("eventKey").equals(redemptionEventKey(request.id)).count(), 1)
  assert.equal((await getBalance(M0_CHILD_ID)).balance, 50, "只能扣一次 50")
})

test("M2-RD9 家长审核列表带快照、孩子与当前余额", async (t) => {
  await useCleanDatabase(t)
  await fund(35)
  const request = await requestRedemption({ childId: M0_CHILD_ID, rewardId: "rw_costume_glasses_round" })

  const rows = await listRedemptionRequests()
  assert.equal(rows.length, 1)
  assert.equal(rows[0].id, request.id)
  assert.equal(rows[0].rewardNameSnapshot, "圆框眼镜")
  assert.equal(rows[0].costSnapshot, 25)
  assert.equal(rows[0].balance, 35)
  assert.equal(rows[0].child.nickname, "朵朵")
  assert.equal(rows[0].child.id, M0_CHILD_ID)
})

/* ================= M5：多选后一起提交 ================= */

const HAT = "rw_costume_hat_straw" // 20
const GLASSES = "rw_costume_glasses_round" // 25
const SCARF = "rw_costume_scarf_knit" // 30
const PLAY15 = "rw_life_play15" // 20
const CARTOON = "rw_life_cartoon" // 30
const PARK = "rw_life_park" // 50

test("M5-RD1 一次提交多件：同一批次、逐件快照、不扣分不写流水", async (t) => {
  await useCleanDatabase(t)
  await fund(100)
  const before = await getBalance(M0_CHILD_ID)

  const batch = await requestRedemptions({
    childId: M0_CHILD_ID,
    rewardIds: [HAT, GLASSES, PLAY15],
  })

  assert.equal(batch.records.length, 3)
  assert.equal(batch.totalCost, 65)
  assert.deepEqual(
    [...new Set(batch.records.map((row) => row.batchId))],
    [batch.batchId],
    "一个批次共用同一个 batchId",
  )
  assert.ok(batch.records.every((row) => row.status === "pending"))

  const hat = batch.records.find((row) => row.rewardId === HAT)
  assert.equal(hat.costSnapshot, 20)
  assert.equal(hat.categorySnapshot, "costume")
  assert.equal(hat.costumeKeySnapshot, "hat_straw")
  assert.equal(hat.assetKeySnapshot, "costume_hat_straw")
  const play = batch.records.find((row) => row.rewardId === PLAY15)
  assert.equal(play.categorySnapshot, "life")
  assert.equal(Object.hasOwn(play, "costumeKeySnapshot"), false)

  const after = await getBalance(M0_CHILD_ID)
  assert.equal(after.balance, before.balance, "申请不能扣分")
  assert.equal(after.entryCount, before.entryCount, "申请不能写流水")

  const rows = await listRedemptionRequests()
  assert.equal(rows.length, 3, "家长侧看到 3 行，按 batchId 合成一张卡")
  assert.equal(new Set(rows.map((row) => row.batchId)).size, 1)
  assert.equal(rows[0].balance, 100)
})

test("M5-RD2 单件都够但合计不够：整批挡回，零写入", async (t) => {
  await useCleanDatabase(t)
  await fund(60) // 公园 50 + 动画 30 = 80，单件都买得起
  const ledgerBefore = await getDb().pointLedger.count()

  await assert.rejects(
    () => requestRedemptions({ childId: M0_CHILD_ID, rewardIds: [PARK, CARTOON] }),
    (error) =>
      error.code === DB_ERROR_CODES.VALIDATION_FAILED &&
      /还差 20 颗星星/.test(error.message) &&
      error.context?.shortage === 20 &&
      error.context?.cost === 80,
    "合计不够必须整批挡住，并给出还差多少",
  )

  assert.equal(await getDb().redemptions.count(), 0, "不能留下半批申请")
  assert.equal(await getDb().pointLedger.count(), ledgerBefore)
  assert.equal((await getBalance(M0_CHILD_ID)).balance, 60)
})

test("M5-RD3 已有待确认批次时不能再开新批", async (t) => {
  await useCleanDatabase(t)
  await fund(100)
  await requestRedemptions({ childId: M0_CHILD_ID, rewardIds: [HAT, GLASSES] })

  await assert.rejects(
    () => requestRedemptions({ childId: M0_CHILD_ID, rewardIds: [PLAY15] }),
    (error) => error.code === DB_ERROR_CODES.VALIDATION_FAILED && /等爸爸妈妈确认/.test(error.message),
  )
  assert.equal(await getDb().redemptions.count(), 2)
})

test("M5-RD4 按批确认：一次扣合计、逐件流水、逐件到账", async (t) => {
  await useCleanDatabase(t)
  await fund(100)
  const batch = await requestRedemptions({ childId: M0_CHILD_ID, rewardIds: [HAT, GLASSES, PLAY15] })

  const result = await acceptRedemptionBatch({ batchId: batch.batchId })
  assert.equal(result.status, "accepted")
  assert.equal(result.accepted.length, 3)
  assert.deepEqual(result.rejected, [])
  assert.equal(result.totalCost, 65)
  assert.equal(result.balanceBefore, 100)
  assert.equal(result.balanceAfter, 35)

  const ledger = await getDb().pointLedger.where("source").equals("redeem").toArray()
  assert.equal(ledger.length, 3, "每件一条流水，方便孩子看到花在哪儿")
  assert.deepEqual(ledger.map((entry) => entry.delta).sort((a, b) => a - b), [-25, -20, -20])
  assert.ok(ledger.every((entry) => entry.eventKey === redemptionEventKey(entry.redemptionId)))

  const owned = await getDb().petCostumeOwnerships.toArray()
  assert.equal(owned.length, 2, "两件装扮一次到账")
  assert.deepEqual(owned.map((row) => row.costumeKey).sort(), ["glasses_round", "hat_straw"])

  const stored = await getDb().redemptions.toArray()
  assert.ok(stored.every((row) => row.status === "accepted" && row.handledAt))
  assert.equal((await getBalance(M0_CHILD_ID)).balance, 35)
  assert.equal((await listRedemptionRequests()).length, 0, "处理完就不该再出现在待处理里")
})

test("M5-RD5 只勾其中几件：未勾选的同事务退回，不留悬挂 pending", async (t) => {
  await useCleanDatabase(t)
  await fund(100)
  const batch = await requestRedemptions({ childId: M0_CHILD_ID, rewardIds: [HAT, GLASSES, PLAY15] })
  const drop = batch.records.find((row) => row.rewardId === PLAY15)

  const result = await acceptRedemptionBatch({
    batchId: batch.batchId,
    acceptedIds: batch.records.filter((row) => row.rewardId !== PLAY15).map((row) => row.id),
    parentMessage: "这周先不换游戏时间",
  })
  assert.equal(result.accepted.length, 2)
  assert.equal(result.rejected.length, 1)
  assert.equal(result.rejected[0].id, drop.id)
  assert.equal(result.totalCost, 45, "只扣勾选的")
  assert.equal((await getBalance(M0_CHILD_ID)).balance, 55)

  const stored = await getDb().redemptions.get(drop.id)
  assert.equal(stored.status, "rejected")
  assert.equal(stored.parentMessage, "这周先不换游戏时间")

  // 没有悬挂 pending：孩子可以马上提交新的一批
  const next = await requestRedemptions({ childId: M0_CHILD_ID, rewardIds: [PLAY15] })
  assert.equal(next.records.length, 1)
})

test("M5-RD6 重复确认整批：不重复扣分、不重复收藏", async (t) => {
  await useCleanDatabase(t)
  await fund(100)
  const batch = await requestRedemptions({ childId: M0_CHILD_ID, rewardIds: [HAT, PLAY15] })

  await acceptRedemptionBatch({ batchId: batch.batchId })
  const again = await acceptRedemptionBatch({ batchId: batch.batchId })
  assert.equal(again.status, "duplicate")
  assert.equal(again.accepted.length, 0)

  assert.equal(await getDb().pointLedger.where("source").equals("redeem").count(), 2)
  assert.equal(await getDb().petCostumeOwnerships.count(), 1)
  assert.equal((await getBalance(M0_CHILD_ID)).balance, 60, "只能扣一次 40")
})

test("M5-RD7 整批退回：不扣分、全部终态、之后不能再确认", async (t) => {
  await useCleanDatabase(t)
  await fund(100)
  const batch = await requestRedemptions({ childId: M0_CHILD_ID, rewardIds: [GLASSES, CARTOON] })

  const rejected = await rejectRedemptionBatch({ batchId: batch.batchId, parentMessage: "先攒着" })
  assert.equal(rejected.status, "rejected")
  assert.equal(rejected.rejected.length, 2)
  assert.equal((await getBalance(M0_CHILD_ID)).balance, 100, "退回不能扣分")
  assert.equal(await getDb().pointLedger.where("source").equals("redeem").count(), 0)

  const stored = await getDb().redemptions.toArray()
  assert.ok(stored.every((row) => row.status === "rejected" && row.parentMessage === "先攒着"))

  await assert.rejects(
    () => acceptRedemptionBatch({ batchId: batch.batchId }),
    (error) => error.code === DB_ERROR_CODES.VALIDATION_FAILED,
  )
  const dup = await rejectRedemptionBatch({ batchId: batch.batchId })
  assert.equal(dup.status, "duplicate")
})

test("M5-RD8 同一件重复传只算一次；超过上限直接拒绝", async (t) => {
  await useCleanDatabase(t)
  await fund(300)

  const deduped = await requestRedemptions({ childId: M0_CHILD_ID, rewardIds: [HAT, HAT, " ", HAT] })
  assert.equal(deduped.records.length, 1)
  assert.equal(deduped.totalCost, 20)

  // 换成另一批：先把上一批退掉
  await rejectRedemptionBatch({ batchId: deduped.batchId })

  const tooMany = [HAT, GLASSES, SCARF, PARK, CARTOON, PLAY15, "rw_costume_bg_starry"]
  assert.equal(tooMany.length, MAX_BATCH_ITEMS + 1)
  await assert.rejects(
    () => requestRedemptions({ childId: M0_CHILD_ID, rewardIds: tooMany }),
    (error) => error.code === DB_ERROR_CODES.VALIDATION_FAILED && /最多换/.test(error.message),
  )

  await assert.rejects(
    () => requestRedemptions({ childId: M0_CHILD_ID, rewardIds: [] }),
    (error) => error.code === DB_ERROR_CODES.VALIDATION_FAILED,
  )
})

test("M5-RD9 老数据兼容：没有 batchId 的单件仍按单件确认 / 退回", async (t) => {
  await useCleanDatabase(t)
  await fund(100)

  // 模拟 M2 时期写入的行（无 batchId）
  const legacy = {
    id: "rdm_legacy_hat",
    childId: M0_CHILD_ID,
    rewardId: HAT,
    status: "pending",
    rewardNameSnapshot: "小草帽",
    costSnapshot: 20,
    categorySnapshot: "costume",
    costumeKeySnapshot: "hat_straw",
    assetKeySnapshot: "costume_hat_straw",
    requestedAt: "2026-01-01T00:00:00.000Z",
  }
  await getDb().redemptions.add(legacy)

  // 批次接口用「自身 id 当批次号」，单件表现与 M2 一致
  const result = await acceptRedemptionBatch({ batchId: legacy.id })
  assert.equal(result.status, "accepted")
  assert.equal(result.totalCost, 20)
  assert.equal((await getDb().redemptions.get(legacy.id)).status, "accepted")
  assert.equal(await getDb().petCostumeOwnerships.count(), 1)

  // 旧接口也还能用
  const legacyTwo = { ...legacy, id: "rdm_legacy_play", rewardId: PLAY15, rewardNameSnapshot: "额外玩 15 分钟", costSnapshot: 20, categorySnapshot: "life" }
  delete legacyTwo.costumeKeySnapshot
  delete legacyTwo.assetKeySnapshot
  await getDb().redemptions.add(legacyTwo)
  const single = await acceptRedemption({ redemptionId: legacyTwo.id })
  assert.equal(single.status, "accepted")
  assert.equal(single.balanceAfter, 60)
})

