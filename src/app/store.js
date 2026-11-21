/**
 * 数据适配层（M3）。
 *
 * 纪律：
 * - 页面不直接操作表，写操作只走 services；
 * - 切换孩子 = 换 childId 后整体重载，任何页面都不缓存上一个孩子的数据；
 * - 余额、等级、连续天数都是派生值，不写字段、不建缓存表；
 * - 奖励价格读 `cost`（家庭当前价），申请与扣分只认 `costSnapshot`；
 * - **家长 PIN 的会话状态只存内存**（`gateUnlocked`），刷新即失效，不写库；
 * - 备份 / 恢复、固定任务也只在 store 里调服务，界面不碰 `db.tables`。
 */

import { getDb, openDatabase } from "../db/database.js"
import { toLocalDateKey } from "../db/date.js"
import { approveTask, rejectTask } from "../services/approval.service.js"
import {
  backupOverview,
  exportBackup,
  parseBackupText,
  restoreBackup,
  undoLastRestore,
  wipeAllData,
} from "../services/backup.service.js"
import { createChild, listChildren } from "../services/child.service.js"
import { equipCostume, listCostumeCollection, unequipCostume } from "../services/costume.service.js"
import {
  checkParentPin,
  clearParentPin,
  getPinStatus,
  issueRecoveryCode,
  resetParentPinWithRecovery,
  setParentPin,
  verifyRecoveryCode,
} from "../services/pin.service.js"
import { getBalance } from "../services/points.service.js"
import {
  acceptRedemption,
  acceptRedemptionBatch,
  listRedemptionRequests,
  listRedemptionsByChild,
  rejectRedemption,
  rejectRedemptionBatch,
  requestRedemption,
  requestRedemptions,
} from "../services/redemption.service.js"
import {
  createCustomReward,
  ensureBuiltinRewardConfigs,
  listRewards,
  setRewardEnabled,
  updateReward,
} from "../services/reward.service.js"
import { getCurrentStreak } from "../services/streak.service.js"
import {
  createTask,
  ensureSeedData,
  listOverdueTasks,
  listTodayTasks,
  listUpcomingTasks,
  M0_CHILD_ID,
  submitTask,
} from "../services/task.service.js"
import {
  createTemplate,
  deleteTemplate,
  ensureTodayTemplateTasks,
  listTemplates,
  setTemplateEnabled,
} from "../services/template.service.js"

const CHILD_STORAGE_KEY = "b002.currentChildId"

export const state = {
  page: "tasks",
  filter: "all",
  childId: null,
  children: [],
  child: null,
  /** 今天的任务（四种状态） */
  tasks: [],
  /** 逾期未完成任务（dueDate < 今天且未通过） */
  overdue: [],
  /** 接下来 7 天已安排的任务（不含今天） */
  upcoming: [],
  submissions: new Map(),
  balance: 0,
  /** 上一次渲染时的余额，用于数字滚动起点 */
  lastBalance: null,
  petExp: 0,
  ledger: [],
  todayApproved: 0,
  todayStars: 0,
  streak: 0,
  /** 孩子管理页用的聚合统计，按需加载 */
  childStats: [],
  showOverdue: false,
  busy: null,
  booted: false,

  /* ---------- M2：奖励与装扮 ---------- */
  /** 全部奖励（含停用，切换孩子时无需重载；停用只在孩子端过滤） */
  rewards: [],
  /** 当前孩子的兑换申请（时间倒序） */
  redemptions: [],
  /** 全部孩子的待处理申请（家长审核页用） */
  pendingRequests: [],
  /** 当前孩子的收藏与穿戴 */
  costume: { owned: [], ownedKeys: [], worn: {}, bySlot: {} },
  /** 孩子端商城分类：life | costume */
  shopTab: "life",
  /** 孩子端商城已勾选的奖励 id（一次可多选，提交时合成一个批次） */
  shopPicked: [],
  /** 家长端奖励管理分类：life | costume */
  rewardTab: "life",
  /** 家长端奖励管理只显示某一类来源时可切换；默认全部 */
  rewardSourceFilter: "all",

  /* ---------- M3：权限 / 备份 / 固定任务 ---------- */
  /** PIN 状态（只有"有没有配"，没有哈希） */
  pinStatus: {
    configured: false,
    updatedAt: null,
    failedCount: 0,
    lockedUntil: null,
    recoveryConfigured: false,
    recoveryUpdatedAt: null,
  },
  /** 本次会话是否已通过 PIN。**只存内存**：刷新即回到未解锁 */
  gateUnlocked: false,
  /** 固定任务模板（含停用） */
  templates: [],
  /** 设置页用的备份概览，按需加载（每次 loadAll 都数 14 张表太浪费） */
  backup: {
    lastBackupAt: null,
    lastBackupFileName: null,
    lastBackupVersion: null,
    counts: {},
    total: 0,
    canUndo: false,
    undoSnapshotAt: null,
    undoSnapshotTotal: 0,
  },
}

export const LEDGER_PREVIEW_LIMIT = 8

function readStoredChildId() {
  try {
    return window.localStorage.getItem(CHILD_STORAGE_KEY)
  } catch {
    return null
  }
}

function persistChildId(childId) {
  try {
    window.localStorage.setItem(CHILD_STORAGE_KEY, childId)
  } catch {
    // 本地偏好写不进去不影响主流程
  }
}

export async function boot() {
  await openDatabase()
  await ensureSeedData()
  // 奖励配置与孩子 / 任务分开幂等补齐：只补缺失，不覆盖家长改过的价格与启停
  await ensureBuiltinRewardConfigs()

  // 固定任务：补齐今天的实例。失败不阻塞启动（老库没有模板时这里是空操作）
  try {
    await ensureTodayTemplateTasks()
  } catch {
    // 生成失败最坏结果是今天没有自动任务，家长仍可手动布置
  }

  state.pinStatus = await getPinStatus()
  // 刷新 = 新的会话：即使上次通过过 PIN，也要重新验证
  state.gateUnlocked = false

  const children = await listChildren()
  state.children = children

  const remembered = readStoredChildId()
  const active =
    children.find((child) => child.id === remembered) ??
    children.find((child) => child.id === M0_CHILD_ID) ??
    children[0] ??
    null

  state.childId = active?.id ?? M0_CHILD_ID
  persistChildId(state.childId)

  await loadAll()
  state.booted = true
}

export async function loadAll() {
  const db = getDb()
  const childId = state.childId
  const todayKey = toLocalDateKey()

  if (!childId) throw new Error("当前没有可用的孩子")

  const [
    child,
    tasks,
    overdue,
    upcoming,
    balance,
    petEntries,
    submissionEntries,
    ledgerEntries,
    streak,
    rewards,
    redemptions,
    costume,
    pendingRequests,
    templates,
  ] = await Promise.all([
    db.children.get(childId),
    listTodayTasks(childId),
    listOverdueTasks(childId),
    listUpcomingTasks(childId),
    getBalance(childId),
    db.petProgress.where("childId").equals(childId).toArray(),
    db.submissions.where("childId").equals(childId).toArray(),
    db.pointLedger.where("childId").equals(childId).toArray(),
    getCurrentStreak(childId),
    listRewards(),
    listRedemptionsByChild(childId),
    listCostumeCollection(childId),
    listRedemptionRequests(),
    listTemplates(),
  ])

  state.child = child ?? null
  state.tasks = tasks
  state.overdue = overdue
  state.upcoming = upcoming
  state.balance = balance.balance
  state.petExp = petEntries.reduce((sum, entry) => sum + (Number(entry?.delta) || 0), 0)
  state.streak = streak.days
  state.rewards = rewards
  state.redemptions = redemptions
  state.costume = costume
  state.pendingRequests = pendingRequests
  state.templates = templates

  // 每条任务只保留最新一版提交（version 最大）
  state.submissions = new Map()
  for (const submission of submissionEntries) {
    const previous = state.submissions.get(submission.taskId)
    if (!previous || submission.version > previous.version) {
      state.submissions.set(submission.taskId, submission)
    }
  }

  // 流水时间倒序；日期标签一律用 approvalDate，不对 ISO 字符串截位（R-08）
  state.ledger = [...ledgerEntries]
    .sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")))
    .slice(0, LEDGER_PREVIEW_LIMIT)
    .map((entry) => ({
      id: entry.id,
      delta: entry.delta,
      reason: entry.reason,
      approvalDate: entry.approvalDate ?? null,
      createdAt: entry.createdAt,
    }))

  // 今日星星只统计任务奖励：兑换流水不写 approvalDate，天然被排除
  state.todayStars = ledgerEntries
    .filter((entry) => entry.approvalDate === todayKey)
    .reduce((sum, entry) => sum + (Number(entry?.delta) || 0), 0)

  state.todayApproved = state.tasks.filter((task) => task.status === "approved").length

  return state
}

/** 所有孩子的聚合统计（孩子管理页 / 切换面板用），按需调用。 */
export async function ensureChildStats() {
  if (!state.children.length) {
    state.children = await listChildren()
  }

  state.childStats = await Promise.all(
    state.children.map(async (child) => {
      const [today, overdue, balance, streak] = await Promise.all([
        listTodayTasks(child.id),
        listOverdueTasks(child.id),
        getBalance(child.id),
        getCurrentStreak(child.id),
      ])
      const approved = today.filter((task) => task.status === "approved").length
      const pending = [...today, ...overdue].filter((task) => task.status === "submitted").length
      return {
        ...child,
        todayTotal: today.length,
        approved,
        pending,
        overdue: overdue.length,
        balance: balance.balance,
        streak: streak.days,
      }
    }),
  )

  return state.childStats
}

export function taskById(taskId) {
  return (
    state.tasks.find((task) => task.id === taskId) ??
    state.overdue.find((task) => task.id === taskId) ??
    null
  )
}

export function submissionOf(taskId) {
  return state.submissions.get(taskId) ?? null
}

/* ---------------- M2：奖励 / 兑换 / 装扮 派生查询 ---------------- */

export function rewardById(rewardId) {
  return state.rewards.find((reward) => reward.id === rewardId) ?? null
}

/** 该孩子当前唯一的一条待确认申请（没有则 null）。多件时只返回第一件，仅作兼容。 */
export function pendingRedemptionOf(childId = state.childId) {
  return pendingRedemptionsOf(childId)[0] ?? null
}

/** 该孩子当前待确认的整批申请（多件时是同一批次的全部行），按申请顺序 */
export function pendingRedemptionsOf(childId = state.childId) {
  return state.redemptions
    .filter((redemption) => redemption.childId === childId && redemption.status === "pending")
    .sort((a, b) => String(a.requestedAt ?? "").localeCompare(String(b.requestedAt ?? "")))
}

/** 当前待确认批次号（没有则 null） */
export function pendingBatchIdOf(childId = state.childId) {
  const first = pendingRedemptionsOf(childId)[0]
  return first ? (first.batchId ?? first.id) : null
}

/** 把一个奖励 id 加进 / 移出勾选清单，返回新的勾选数组 */
export function toggleShopPick(rewardId) {
  const picked = state.shopPicked.includes(rewardId)
    ? state.shopPicked.filter((id) => id !== rewardId)
    : [...state.shopPicked, rewardId]
  state.shopPicked = picked
  return picked
}

export function clearShopPicks() {
  state.shopPicked = []
}

export function isCostumeOwned(costumeKey) {
  return state.costume.ownedKeys.includes(costumeKey)
}

/** 某个类别当前穿戴的 costumeKey（没穿返回 null） */
export function wornIn(slot) {
  return state.costume.worn?.[slot] ?? null
}

/** 已拥有但未穿戴的某类别装扮（用于「换一件」） */
export function ownedInSlot(slot) {
  return state.costume.bySlot?.[slot] ?? []
}

/* ---------------- 动作 ---------------- */

/** 切换当前孩子：换 id → 持久化偏好 → 整体重载。 */
export async function switchChild(childId) {
  if (!state.children.some((child) => child.id === childId)) {
    throw new Error(`未知的孩子：${childId}`)
  }
  state.childId = childId
  persistChildId(childId)
  state.filter = "all"
  state.showOverdue = false
  // 换孩子 = 换一整套勾选，绝不带到下一个孩子
  state.shopPicked = []
  await loadAll()
  return state.child
}

export async function doSubmit({ taskId, content }) {
  const task = taskById(taskId)
  return submitTask({
    taskId,
    childId: task?.childId ?? state.childId,
    contentType: "text",
    content,
  })
}

export async function doApprove({ taskId }) {
  return approveTask({ taskId, reviewerId: "parent" })
}

export async function doReject({ taskId, reason }) {
  return rejectTask({ taskId, reason, reviewerId: "parent" })
}

export async function doCreateTask({ childId, title, points, dueDate }) {
  return createTask({ childId: childId || state.childId, title, points, dueDate })
}

export async function doCreateChild({ nickname, avatarKey }) {
  const child = await createChild({ nickname, avatarKey })
  state.children = await listChildren()
  await switchChild(child.id)
  return child
}

/** 孩子申请兑换：不扣分、不写流水，只写 pending + 快照。 */
export async function doRequestRedemption({ rewardId, childId }) {
  return requestRedemption({ childId: childId || state.childId, rewardId })
}

/** 孩子一次提交多件：一个批次、多条 pending，合计校验通过才落库 */
export async function doRequestRedemptions({ rewardIds, childId }) {
  const result = await requestRedemptions({ childId: childId || state.childId, rewardIds })
  state.shopPicked = []
  return result
}

/** 家长确认兑换：唯一扣分路径。 */
export async function doAcceptRedemption({ redemptionId }) {
  return acceptRedemption({ redemptionId })
}

/** 家长按批确认：勾选的通过，未勾选的在同一个事务里退回 */
export async function doAcceptRedemptionBatch({ batchId, acceptedIds, parentMessage }) {
  return acceptRedemptionBatch({ batchId, acceptedIds, parentMessage })
}

export async function doRejectRedemption({ redemptionId, parentMessage }) {
  return rejectRedemption({ redemptionId, parentMessage })
}

/** 家长整批退回：只改状态，不扣分 */
export async function doRejectRedemptionBatch({ batchId, parentMessage }) {
  return rejectRedemptionBatch({ batchId, parentMessage })
}

export async function doEquipCostume({ costumeKey }) {
  return equipCostume({ childId: state.childId, costumeKey })
}

export async function doUnequipCostume({ slot }) {
  return unequipCostume({ childId: state.childId, slot })
}

export async function doUpdateReward({ rewardId, cost }) {
  const reward = await updateReward({ rewardId, cost })
  state.rewards = await listRewards()
  return reward
}

export async function doSetRewardEnabled({ rewardId, enabled }) {
  const reward = await setRewardEnabled({ rewardId, enabled })
  state.rewards = await listRewards()
  return reward
}

export async function doCreateReward({ name, description, cost, iconKey }) {
  const reward = await createCustomReward({ name, description, cost, iconKey })
  state.rewards = await listRewards()
  return reward
}

/* ---------------- M3：家长 PIN 门控 ---------------- */

/** 进入家长端是否需要输入 PIN：配了 PIN 且本次会话还没解锁 */
export function needsParentGate() {
  return Boolean(state.pinStatus.configured) && !state.gateUnlocked
}

export async function refreshPinStatus() {
  state.pinStatus = await getPinStatus()
  return state.pinStatus
}

/**
 * 校验 PIN 并解锁本次会话。
 * @param {{ pin: string }} input
 * @returns {Promise<{ allowed: boolean, configured: boolean, reason: string, remainingAttempts?: number, retryAfterMs?: number }>}
 */
export async function doUnlockParent({ pin }) {
  const result = await checkParentPin({ pin })
  if (result.allowed) state.gateUnlocked = true
  state.pinStatus = await getPinStatus()
  return result
}

/** 退出家长模式：只清内存标记，不动数据库 */
export function lockParent() {
  state.gateUnlocked = false
}

export async function doSetParentPin({ pin, currentPin }) {
  const result = await setParentPin({ pin, currentPin })
  await refreshPinStatus()
  // 刚设置完就是家长本人在操作，直接解锁，不必再输一次
  state.gateUnlocked = true
  return result
}

export async function doClearParentPin({ currentPin }) {
  const result = await clearParentPin({ currentPin })
  await refreshPinStatus()
  return result
}

/* ---------------- M4：恢复码与彻底删除 ---------------- */

/**
 * 在一次已经解锁的会话里**再验一次** PIN（删除数据前的二次确认用）。
 * 与 `doUnlockParent` 的区别：不改 `gateUnlocked`，只看这一次对不对。
 * @param {{ pin: string }} input
 */
export async function doRecheckPin({ pin }) {
  return checkParentPin({ pin })
}

/** 只校验恢复码，不写库（界面分两步引导用） */
export async function doVerifyRecoveryCode({ recoveryCode }) {
  return verifyRecoveryCode({ recoveryCode })
}

/**
 * 凭恢复码重置 PIN。成功后自动解锁本次会话（家长刚刚证明了自己是家长）。
 * @param {{ recoveryCode: string, pin: string }} input
 */
export async function doResetPinWithRecovery({ recoveryCode, pin }) {
  const result = await resetParentPinWithRecovery({ recoveryCode, pin })
  await refreshPinStatus()
  state.gateUnlocked = true
  return result
}

/** 生成（覆盖）恢复码：M3 老用户补一份，或主动换一把钥匙 */
export async function doIssueRecoveryCode() {
  const result = await issueRecoveryCode()
  await refreshPinStatus()
  return result
}

/** 清空全部家庭数据（G-05）。调用方负责随后强制刷新页面。 */export async function doWipeAllData() {
  const result = await wipeAllData()
  state.gateUnlocked = false
  state.backup = {
    lastBackupAt: null,
    lastBackupFileName: null,
    lastBackupVersion: null,
    counts: {},
    total: 0,
    canUndo: false,
    undoSnapshotAt: null,
    undoSnapshotTotal: 0,
  }
  try {
    window.localStorage.removeItem(CHILD_STORAGE_KEY)
  } catch {
    // 偏好清不掉不影响数据已经被清空这个事实
  }
  return result
}

/* ---------------- M3：备份 / 恢复 ---------------- */

export async function ensureBackupOverview() {
  state.backup = await backupOverview()
  return state.backup
}

/** 导出：返回文本与文件名，由界面负责触发下载 */
export async function doExportBackup() {
  const result = await exportBackup()
  state.backup = await backupOverview()
  return result
}

/** 只解析校验、不写库（导入确认弹窗展示摘要用） */
export function previewBackup(text) {
  return parseBackupText(text)
}

/** 导入：整库覆盖 + 重新解析当前孩子 + 重载 */
export async function doImportBackup(text) {
  const result = await restoreBackup(text)
  await reloadAfterRestore()
  return result
}

export async function doUndoRestore() {
  const result = await undoLastRestore()
  await reloadAfterRestore()
  return result
}

/** 恢复后库里可能换了一批孩子，必须重新选当前孩子并整体重载 */
async function reloadAfterRestore() {
  state.children = await listChildren()
  const remembered = readStoredChildId()
  const active =
    state.children.find((child) => child.id === remembered) ??
    state.children.find((child) => child.id === M0_CHILD_ID) ??
    state.children[0] ??
    null

  state.childId = active?.id ?? null
  if (state.childId) persistChildId(state.childId)
  state.filter = "all"
  state.showOverdue = false

  await loadAll()
  state.pinStatus = await getPinStatus()
  state.backup = await backupOverview()
  return state
}

/* ---------------- M3：固定任务模板 ---------------- */

export async function doCreateTemplate({ title, points, type, childIds, weekdays }) {
  const template = await createTemplate({ title, points, type, childIds, weekdays })
  // 新建后立刻补齐今天，家长保存完就能在列表里看到这条任务
  await ensureTodayTemplateTasks()
  await loadAll()
  return template
}

export async function doSetTemplateEnabled({ templateId, enabled }) {
  const template = await setTemplateEnabled({ templateId, enabled })
  await loadAll()
  return template
}

export async function doDeleteTemplate({ templateId }) {
  const result = await deleteTemplate({ templateId })
  await loadAll()
  return result
}
