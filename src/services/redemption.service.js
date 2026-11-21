/**
 * 奖励兑换：孩子申请（可一次多件）→ 家长按批确认 / 拒绝。
 *
 * 规则（PRD §6.5、§7.4；tech/contract.md §6、§8）：
 * - 申请**不扣分、不冻结、不写流水**；**星星不够直接拒绝**，不生成必然被驳回的申请；
 * - **一次提交 = 一个批次（batchId）**，同一批次落多条 pending 行（每件一行，各自快照）；
 *   同一孩子同时最多一个未处理批次，判断在写入事务内完成，不依赖按钮禁用；
 * - 批次的合计积分在申请时一次性校验：合计不够就整批挡回，不留下半批申请；
 * - 确认必须在一个事务里完成：复查 pending → 按快照重算余额 → 逐件写负向流水 → 改状态
 *   →（装扮）写收藏。任一步失败整批回滚，绝不出现"扣了分没到账"或"到账没扣分"；
 * - 家长可以逐件勾选，未勾选的件在同一个事务里按拒绝处理，不留下悬挂 pending；
 * - 扣分只认 `costSnapshot`，家长之后改价不影响既有申请；
 * - 幂等键 `redemption:${redemptionId}`（逐件），重复确认不重复扣分、不重复收藏；
 * - 拒绝只改状态，不扣分；accepted / rejected 都是终态。
 */

import Dexie from "dexie"
import { getDb } from "../db/database.js"
import { DbError, DB_ERROR_CODES, wrapDbError } from "../db/errors.js"
import { toIsoTimestamp } from "../db/date.js"
import { makeId } from "../db/ids.js"
import { LEDGER_SOURCE } from "./points.service.js"
import { COSTUME_CATALOG, addOwnershipInTransaction } from "./costume.service.js"

export const REDEMPTION_STATUS = Object.freeze({
  PENDING: "pending",
  ACCEPTED: "accepted",
  REJECTED: "rejected",
})

export const REDEMPTION_RESULT = Object.freeze({
  ACCEPTED: "accepted",
  DUPLICATE: "duplicate",
  REJECTED: "rejected",
})

/** 家长给孩子的拒绝说明长度上限 */
export const PARENT_MESSAGE_MAX_LENGTH = 40

/** 一批最多同时申请几件：够用，且不至于让家长一次面对一屏 */
export const MAX_BATCH_ITEMS = 6

export function redemptionEventKey(redemptionId) {
  return `redemption:${redemptionId}`
}

/** 生成批次号（一次提交共用），只做分组用，不做业务主键 */
export function makeRedemptionBatchId() {
  return makeId("bat")
}

function assertId(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, `${name} 必须是非空字符串`, { context: { [name]: value } })
  }
}

function sumDeltas(entries) {
  return entries.reduce((total, entry) => total + (Number.isFinite(entry?.delta) ? entry.delta : 0), 0)
}

/** 事务内重算余额（唯一权威算法：pointLedger.delta 求和） */
async function balanceInTransaction(db, childId) {
  const entries = await db.pointLedger.where("childId").equals(childId).toArray()
  return sumDeltas(entries)
}

/**
 * 孩子发起一次兑换申请：**一次可以选多件，一起提交成一个批次**。
 *
 * 每件落一条 redemption 行（各自快照、各自幂等键），共用同一个 `batchId`；
 * 家长看到的是一张"这批共 N 件"的卡，点一次就整批处理。
 *
 * 写入完整快照：奖励名称、当时价格、类别；装扮另存 costumeKey / assetKey。
 * 之后家长改名、改价、停用都不影响这条申请。
 *
 * **合计星星不够就整批不生成**：申请只是"我想换"，但一批必然被家长驳回的申请
 * 对孩子没有意义，只会增加一次无效往返。所以在孩子端直接挡回并告知还差多少，
 * 由孩子自己去做任务攒星星。家长审核侧的余额校验仍然保留——申请之后星星
 * 仍可能被别的操作花掉，那一步是兜底，不是主流程。
 *
 * @param {{ childId: string, rewardIds: string[], now?: Date, db?: import("dexie").default }} input
 * @returns {Promise<{ batchId: string, childId: string, requestedAt: string, totalCost: number, balance: number, records: Array<Record<string, unknown>> }>}
 */
export async function requestRedemptions({ childId, rewardIds, now = new Date(), db = getDb() } = {}) {
  assertId(childId, "childId")
  // 去重、去空：同一次提交里同一件只算一次
  const ids = Array.isArray(rewardIds)
    ? [...new Set(rewardIds.filter((id) => typeof id === "string" && id.trim() !== "").map((id) => id.trim()))]
    : []
  if (!ids.length) {
    throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "先挑一件想换的吧", { context: { childId, rewardIds } })
  }
  if (ids.length > MAX_BATCH_ITEMS) {
    throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, `一次最多换 ${MAX_BATCH_ITEMS} 件，分两次告诉爸爸妈妈吧`, {
      context: { childId, count: ids.length, max: MAX_BATCH_ITEMS },
    })
  }

  const requestedAt = toIsoTimestamp(now)
  const batchId = makeRedemptionBatchId()

  try {
    return await db.transaction(
      "rw",
      db.rewards,
      db.redemptions,
      db.children,
      db.petCostumeOwnerships,
      // 余额校验要读流水：Dexie 事务必须先把用到的表全部声明，否则读写会报 Table not part of transaction
      db.pointLedger,
      async () => {
        if (!(await db.children.get(childId))) {
          throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "孩子不存在", { context: { childId } })
        }

        // 同一孩子同时最多一批 pending：必须在事务内复查，不能只靠界面禁用
        const pending = await db.redemptions.where("[childId+status]").equals([childId, REDEMPTION_STATUS.PENDING]).first()
        if (pending) {
          throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "已经有一批在等爸爸妈妈确认了，等这批处理完再换", {
            context: { childId, pendingId: pending.id, pendingBatchId: pending.batchId ?? pending.id },
          })
        }

        // 逐件校验、逐件落快照：任何一件不合格，整批都不生成
        const records = []
        const seenCostumeKeys = new Set()
        for (const rewardId of ids) {
          const reward = await db.rewards.get(rewardId)
          if (!reward) {
            throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "奖励不存在", { context: { rewardId } })
          }
          if (reward.enabled === false) {
            throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, `「${reward.name}」暂停兑换了`, {
              context: { rewardId, childId },
            })
          }
          if (!Number.isInteger(reward.cost) || reward.cost < 0) {
            throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "奖励积分配置异常", {
              context: { rewardId, cost: reward.cost },
            })
          }

          const category = reward.category === "costume" ? "costume" : "life"
          let costumeKey = null
          if (category === "costume") {
            costumeKey = reward.costumeKey ?? null
            const costume = COSTUME_CATALOG.find((item) => item.costumeKey === costumeKey)
            if (!costume) {
              throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "装扮目录里没有这个素材", {
                context: { rewardId, costumeKey },
              })
            }
            if (seenCostumeKeys.has(costumeKey)) {
              throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "同一件装扮只需要换一次", {
                context: { childId, costumeKey },
              })
            }
            seenCostumeKeys.add(costumeKey)
            // 已拥有不再提供兑换入口；服务层同样拦住
            const owned = await db.petCostumeOwnerships
              .where("[childId+costumeKey]")
              .equals([childId, costumeKey])
              .first()
            if (owned) {
              throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "已经拥有这个装扮了", {
                context: { childId, costumeKey },
              })
            }
          }

          records.push({
            id: makeId("rdm"),
            batchId,
            childId,
            rewardId,
            status: REDEMPTION_STATUS.PENDING,
            rewardNameSnapshot: reward.name,
            costSnapshot: reward.cost,
            categorySnapshot: category,
            requestedAt,
            ...(costumeKey
              ? {
                  costumeKeySnapshot: costumeKey,
                  assetKeySnapshot:
                    COSTUME_CATALOG.find((item) => item.costumeKey === costumeKey)?.assetKey ?? costumeKey,
                }
              : {}),
          })
        }

        // 合计不够就整批挡在孩子端：不写 pending、不占"一批"的名额、不打扰家长
        const totalCost = records.reduce((sum, record) => sum + record.costSnapshot, 0)
        const balance = await balanceInTransaction(db, childId)
        if (balance < totalCost) {
          const shortage = totalCost - balance
          throw new DbError(
            DB_ERROR_CODES.VALIDATION_FAILED,
            `还差 ${shortage} 颗星星，先去做任务攒一攒`,
            {
              context: {
                childId,
                rewardIds: ids,
                balance,
                cost: totalCost,
                shortage,
                rule: "must-afford-before-request",
              },
            },
          )
        }

        await db.redemptions.bulkAdd(records)
        return { batchId, childId, requestedAt, totalCost, balance, records }
      },
    )
  } catch (error) {
    if (error instanceof DbError) throw error
    throw wrapDbError(error, { phase: "transaction", context: { childId, rewardIds: ids } })
  }
}

/**
 * 单件申请的便捷入口（保留 M2 签名，内部走批次）。
 * @param {{ childId: string, rewardId: string, now?: Date, db?: import("dexie").default }} input
 * @returns {Promise<Record<string, unknown>>} 写入的 redemption 记录
 */
export async function requestRedemption({ childId, rewardId, now = new Date(), db = getDb() } = {}) {
  assertId(rewardId, "rewardId")
  const batch = await requestRedemptions({ childId, rewardIds: [rewardId], now, db })
  return batch.records[0]
}

/**
 * 家长确认兑换：**唯一会扣分的入口**。
 *
 * 事务顺序（任一步失败整笔回滚）：
 * 1. 幂等：`redemption:${id}` 流水已存在 → 直接返回 duplicate，零写入；
 * 2. 复查申请仍为 pending 且归属正确；
 * 3. 按该孩子全部流水重算余额，与 `costSnapshot` 比较，不足即抛错（零写入）；
 * 4. 写负向流水（source=redeem，关联 redemptionId）；
 * 5. 申请置 accepted + handledAt；
 * 6. 装扮申请在同一事务写收藏（`sourceRedemptionId` 唯一，防重复到账）。
 *
 * @param {{ redemptionId: string, now?: Date, db?: import("dexie").default }} input
 */
export async function acceptRedemption({ redemptionId, now = new Date(), db = getDb() } = {}) {
  assertId(redemptionId, "redemptionId")
  const handledAt = toIsoTimestamp(now)
  const eventKey = redemptionEventKey(redemptionId)
  const ledgerId = makeId("lgr")

  try {
    return await db.transaction(
      "rw",
      db.redemptions,
      db.pointLedger,
      db.petCostumeOwnerships,
      async () => {
        const redemption = await db.redemptions.get(redemptionId)
        if (!redemption) {
          throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "兑换申请不存在", { context: { redemptionId } })
        }

        // 幂等第一道：扣分流水已存在，说明已经确认过
        const existingEntry = await db.pointLedger.where("eventKey").equals(eventKey).first()
        if (existingEntry) {
          return {
            status: REDEMPTION_RESULT.DUPLICATE,
            redemptionId,
            childId: redemption.childId,
            cost: redemption.costSnapshot,
            eventKey,
            handledAt: redemption.handledAt ?? null,
          }
        }

        if (redemption.status === REDEMPTION_STATUS.REJECTED) {
          throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "这条申请已经拒绝了，不能再确认", {
            context: { redemptionId, status: redemption.status },
          })
        }
        if (redemption.status !== REDEMPTION_STATUS.PENDING) {
          throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "只有待处理的申请可以确认", {
            context: { redemptionId, status: redemption.status },
          })
        }

        const cost = redemption.costSnapshot
        if (!Number.isInteger(cost) || cost < 0) {
          throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "申请价格快照异常", {
            context: { redemptionId, cost },
          })
        }

        const balance = await balanceInTransaction(db, redemption.childId)
        if (balance < cost) {
          throw new DbError(
            DB_ERROR_CODES.VALIDATION_FAILED,
            `星星不够：现在 ${balance} 颗，这次需要 ${cost} 颗`,
            {
              context: {
                redemptionId,
                childId: redemption.childId,
                balance,
                cost,
                rule: "balance-must-not-be-negative",
              },
            },
          )
        }

        // ④ 负向流水：兑换扣分只此一条路径
        await db.pointLedger.add({
          id: ledgerId,
          childId: redemption.childId,
          delta: -cost,
          reason: `兑换「${redemption.rewardNameSnapshot}」`,
          source: LEDGER_SOURCE.REDEEM,
          redemptionId,
          eventKey,
          createdAt: handledAt,
          // 不写 approvalDate：兑换不算"当天学习完成"，也不进今日星星统计
        })

        // ⑤ 申请置终态
        await db.redemptions.update(redemptionId, {
          status: REDEMPTION_STATUS.ACCEPTED,
          handledAt,
        })

        // ⑥ 装扮到账（同一事务）
        let ownershipId = null
        if (redemption.categorySnapshot === "costume" && redemption.costumeKeySnapshot) {
          const owned = await db.petCostumeOwnerships
            .where("[childId+costumeKey]")
            .equals([redemption.childId, redemption.costumeKeySnapshot])
            .first()
          if (owned) {
            // 已拥有：不再重复写收藏，但这次扣分依然成立（价格已在申请时确认）
            ownershipId = owned.id
          } else {
            const ownership = await addOwnershipInTransaction(db, {
              childId: redemption.childId,
              costumeKey: redemption.costumeKeySnapshot,
              sourceRedemptionId: redemptionId,
              acquiredAt: handledAt,
            })
            ownershipId = ownership.id
          }
        }

        return {
          status: REDEMPTION_RESULT.ACCEPTED,
          redemptionId,
          childId: redemption.childId,
          rewardName: redemption.rewardNameSnapshot,
          cost,
          balanceBefore: balance,
          balanceAfter: balance - cost,
          ledgerId,
          eventKey,
          ownershipId,
          costumeKey: redemption.costumeKeySnapshot ?? null,
          handledAt,
        }
      },
    )
  } catch (error) {
    if (error instanceof DbError) throw error

    // 唯一索引兜底：并发下另一个请求先写入流水，事务已回滚，按重复处理
    if (error?.name === "ConstraintError") {
      let duplicate = null
      try {
        duplicate = await db.pointLedger.where("eventKey").equals(eventKey).first()
      } catch {
        duplicate = null
      }
      if (duplicate) {
        return {
          status: REDEMPTION_RESULT.DUPLICATE,
          redemptionId,
          childId: duplicate.childId,
          cost: Math.abs(duplicate.delta),
          eventKey,
          handledAt: null,
        }
      }
    }

    throw wrapDbError(error, { phase: "transaction", context: { redemptionId, eventKey } })
  }
}

/**
 * 家长按批确认兑换：**唯一会扣分的入口（批量版）**。
 *
 * 事务顺序（任一步失败整批回滚）：
 * 1. 取出该批次全部行；只有 pending 的才处理，已 accepted 的天然幂等跳过；
 * 2. `acceptedIds` 给了就只通过勾选的件，其余 pending 件在**同一事务**里按拒绝处理——
 *    绝不留下悬挂 pending，否则孩子再也发不出新的一批；
 * 3. 按通过件的 `costSnapshot` 合计，与孩子当前余额比较，不足即抛错（零写入）；
 * 4. 逐件写负向流水（`source=redeem`，幂等键 `redemption:${id}`）；
 * 5. 逐件置 accepted + handledAt；
 * 6. 装扮件在同一事务写收藏（`sourceRedemptionId` 唯一，防重复到账）。
 *
 * @param {{ batchId: string, acceptedIds?: string[] | null, parentMessage?: string, now?: Date, db?: import("dexie").default }} input
 */
export async function acceptRedemptionBatch({
  batchId,
  acceptedIds = null,
  parentMessage = "",
  now = new Date(),
  db = getDb(),
} = {}) {
  assertId(batchId, "batchId")
  const message = typeof parentMessage === "string" ? parentMessage.trim() : ""
  if (message.length > PARENT_MESSAGE_MAX_LENGTH) {
    throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, `说明不能超过 ${PARENT_MESSAGE_MAX_LENGTH} 字`, {
      context: { batchId, length: message.length },
    })
  }
  const pickedNothing = Array.isArray(acceptedIds) && acceptedIds.length === 0
  if (pickedNothing) {
    throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "至少勾一件再通过", { context: { batchId } })
  }
  const wanted = Array.isArray(acceptedIds) ? new Set(acceptedIds) : null
  const handledAt = toIsoTimestamp(now)

  try {
    return await db.transaction("rw", db.redemptions, db.pointLedger, db.petCostumeOwnerships, async () => {
      // 兼容 M2 老数据：没有 batchId 的单件申请自成一批，用自身 id 当批次号
      const rows = await db.redemptions.filter((row) => (row.batchId ?? row.id) === batchId).toArray()
      if (!rows.length) {
        throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "这批申请不存在", { context: { batchId } })
      }

      const pendingRows = rows
        .filter((row) => row.status === REDEMPTION_STATUS.PENDING)
        .sort((a, b) => String(a.requestedAt ?? "").localeCompare(String(b.requestedAt ?? "")))

      if (!pendingRows.length) {
        const acceptedRows = rows.filter((row) => row.status === REDEMPTION_STATUS.ACCEPTED)
        if (!acceptedRows.length) {
          throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "这批已经退回了，不能再确认", {
            context: { batchId },
          })
        }
        return {
          status: REDEMPTION_RESULT.DUPLICATE,
          batchId,
          childId: acceptedRows[0].childId,
          accepted: [],
          rejected: [],
          totalCost: acceptedRows.reduce((sum, row) => sum + (row.costSnapshot ?? 0), 0),
          balanceBefore: null,
          balanceAfter: null,
          handledAt: acceptedRows[0].handledAt ?? null,
        }
      }

      const childId = pendingRows[0].childId
      const toAccept = wanted ? pendingRows.filter((row) => wanted.has(row.id)) : pendingRows
      const toReject = wanted ? pendingRows.filter((row) => !wanted.has(row.id)) : []
      if (!toAccept.length) {
        throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "至少勾一件再通过", { context: { batchId } })
      }

      for (const row of toAccept) {
        if (!Number.isInteger(row.costSnapshot) || row.costSnapshot < 0) {
          throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "申请价格快照异常", {
            context: { batchId, redemptionId: row.id, cost: row.costSnapshot },
          })
        }
      }

      const totalCost = toAccept.reduce((sum, row) => sum + row.costSnapshot, 0)
      const balance = await balanceInTransaction(db, childId)
      if (balance < totalCost) {
        throw new DbError(
          DB_ERROR_CODES.VALIDATION_FAILED,
          `星星不够：现在 ${balance} 颗，这批要 ${totalCost} 颗`,
          {
            context: {
              batchId,
              childId,
              balance,
              cost: totalCost,
              rule: "balance-must-not-be-negative",
            },
          },
        )
      }

      const accepted = []
      for (const row of toAccept) {
        const eventKey = redemptionEventKey(row.id)
        // 幂等：流水已存在（极端并发/半途重试）就不再扣第二次，只把状态补齐
        const existing = await db.pointLedger.where("eventKey").equals(eventKey).first()
        const ledgerId = existing?.id ?? makeId("lgr")
        if (!existing) {
          await db.pointLedger.add({
            id: ledgerId,
            childId,
            delta: -row.costSnapshot,
            reason: `兑换「${row.rewardNameSnapshot}」`,
            source: LEDGER_SOURCE.REDEEM,
            redemptionId: row.id,
            eventKey,
            createdAt: handledAt,
            // 不写 approvalDate：兑换不算"当天学习完成"，也不进今日星星统计
          })
        }

        await db.redemptions.update(row.id, { status: REDEMPTION_STATUS.ACCEPTED, handledAt })

        let ownershipId = null
        if (row.categorySnapshot === "costume" && row.costumeKeySnapshot) {
          const owned = await db.petCostumeOwnerships
            .where("[childId+costumeKey]")
            .equals([childId, row.costumeKeySnapshot])
            .first()
          if (owned) {
            ownershipId = owned.id
          } else {
            const ownership = await addOwnershipInTransaction(db, {
              childId,
              costumeKey: row.costumeKeySnapshot,
              sourceRedemptionId: row.id,
              acquiredAt: handledAt,
            })
            ownershipId = ownership.id
          }
        }

        accepted.push({
          id: row.id,
          rewardName: row.rewardNameSnapshot,
          cost: row.costSnapshot,
          ledgerId,
          ownershipId,
          costumeKey: row.costumeKeySnapshot ?? null,
        })
      }

      // 未勾选的件按拒绝处理：同一事务，绝不留下悬挂 pending
      for (const row of toReject) {
        const next = { ...row, status: REDEMPTION_STATUS.REJECTED, handledAt }
        if (message) next.parentMessage = message
        else delete next.parentMessage
        await db.redemptions.put(next)
      }

      return {
        status: REDEMPTION_RESULT.ACCEPTED,
        batchId,
        childId,
        accepted,
        rejected: toReject.map((row) => ({ id: row.id, rewardName: row.rewardNameSnapshot })),
        totalCost,
        balanceBefore: balance,
        balanceAfter: balance - totalCost,
        handledAt,
      }
    })
  } catch (error) {
    if (error instanceof DbError) throw error
    throw wrapDbError(error, { phase: "transaction", context: { batchId } })
  }
}

/**
 * 家长整批退回：只改状态，绝不扣分、不发装扮。
 *
 * @param {{ batchId: string, parentMessage?: string, now?: Date, db?: import("dexie").default }} input
 */
export async function rejectRedemptionBatch({ batchId, parentMessage = "", now = new Date(), db = getDb() } = {}) {
  assertId(batchId, "batchId")
  const message = typeof parentMessage === "string" ? parentMessage.trim() : ""
  if (message.length > PARENT_MESSAGE_MAX_LENGTH) {
    throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, `说明不能超过 ${PARENT_MESSAGE_MAX_LENGTH} 字`, {
      context: { batchId, length: message.length },
    })
  }
  const handledAt = toIsoTimestamp(now)

  try {
    return await db.transaction("rw", db.redemptions, async () => {
      // 兼容 M2 老数据：没有 batchId 的单件申请自成一批，用自身 id 当批次号
      const rows = await db.redemptions.filter((row) => (row.batchId ?? row.id) === batchId).toArray()
      if (!rows.length) {
        throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "这批申请不存在", { context: { batchId } })
      }
      const pendingRows = rows.filter((row) => row.status === REDEMPTION_STATUS.PENDING)
      if (!pendingRows.length) {
        const rejectedRows = rows.filter((row) => row.status === REDEMPTION_STATUS.REJECTED)
        if (!rejectedRows.length) {
          throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "这批已经兑换了，不能再退回", {
            context: { batchId },
          })
        }
        return {
          status: REDEMPTION_RESULT.DUPLICATE,
          batchId,
          childId: rejectedRows[0].childId,
          rejected: [],
          handledAt: rejectedRows[0].handledAt ?? null,
        }
      }

      for (const row of pendingRows) {
        const next = { ...row, status: REDEMPTION_STATUS.REJECTED, handledAt }
        if (message) next.parentMessage = message
        else delete next.parentMessage
        await db.redemptions.put(next)
      }

      return {
        status: REDEMPTION_RESULT.REJECTED,
        batchId,
        childId: pendingRows[0].childId,
        rejected: pendingRows.map((row) => ({ id: row.id, rewardName: row.rewardNameSnapshot })),
        parentMessage: message || null,
        handledAt,
      }
    })
  } catch (error) {
    if (error instanceof DbError) throw error
    throw wrapDbError(error, { phase: "transaction", context: { batchId } })
  }
}

/**
 * 家长拒绝：只改状态，绝不扣分、不发装扮。
 *
 * @param {{ redemptionId: string, parentMessage?: string, now?: Date, db?: import("dexie").default }} input
 */
export async function rejectRedemption({ redemptionId, parentMessage = "", now = new Date(), db = getDb() } = {}) {
  assertId(redemptionId, "redemptionId")
  const message = typeof parentMessage === "string" ? parentMessage.trim() : ""
  if (message.length > PARENT_MESSAGE_MAX_LENGTH) {
    throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, `说明不能超过 ${PARENT_MESSAGE_MAX_LENGTH} 字`, {
      context: { redemptionId, length: message.length },
    })
  }
  const handledAt = toIsoTimestamp(now)

  try {
    return await db.transaction("rw", db.redemptions, db.pointLedger, async () => {
      const redemption = await db.redemptions.get(redemptionId)
      if (!redemption) {
        throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "兑换申请不存在", { context: { redemptionId } })
      }
      if (redemption.status === REDEMPTION_STATUS.ACCEPTED) {
        throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "这条申请已经确认兑换了，不能再拒绝", {
          context: { redemptionId, status: redemption.status },
        })
      }
      if (redemption.status === REDEMPTION_STATUS.REJECTED) {
        return {
          status: REDEMPTION_RESULT.DUPLICATE,
          redemptionId,
          childId: redemption.childId,
          handledAt: redemption.handledAt ?? null,
        }
      }

      const next = {
        ...redemption,
        status: REDEMPTION_STATUS.REJECTED,
        handledAt,
      }
      if (message) next.parentMessage = message
      else delete next.parentMessage
      await db.redemptions.put(next)

      return {
        status: REDEMPTION_RESULT.REJECTED,
        redemptionId,
        childId: redemption.childId,
        rewardName: redemption.rewardNameSnapshot,
        parentMessage: message || null,
        handledAt,
      }
    })
  } catch (error) {
    if (error instanceof DbError) throw error
    throw wrapDbError(error, { phase: "transaction", context: { redemptionId } })
  }
}

/**
 * 家长审核列表：全部孩子的待处理申请，附带孩子档案与**当前**流水余额。
 * 余额只作展示与是否够扣的提示，真正校验发生在 acceptRedemption 事务内。
 */
export async function listRedemptionRequests({ status = REDEMPTION_STATUS.PENDING, db = getDb() } = {}) {
  try {
    const rows = await db.redemptions.where("status").equals(status).toArray()
    const children = await db.children.toArray()
    const childMap = new Map(children.map((child) => [child.id, child]))

    const pendingOnly = rows.sort((a, b) =>
      String(a.requestedAt ?? "").localeCompare(String(b.requestedAt ?? "")),
    )

    return Promise.all(
      pendingOnly.map(async (row) => {
        const entries = await db.pointLedger.where("childId").equals(row.childId).toArray()
        return {
          ...row,
          child: childMap.get(row.childId) ?? null,
          balance: sumDeltas(entries),
        }
      }),
    )
  } catch (error) {
    throw wrapDbError(error, { phase: "read", context: { status } })
  }
}

/** 某个孩子的申请历史（时间倒序），用于孩子端「我的申请」。 */
export async function listRedemptionsByChild(childId, db = getDb()) {
  assertId(childId, "childId")
  try {
    return await db.redemptions
      .where("[childId+requestedAt]")
      .between([childId, Dexie.minKey], [childId, Dexie.maxKey])
      .reverse()
      .toArray()
  } catch (error) {
    throw wrapDbError(error, { phase: "read", context: { childId } })
  }
}
