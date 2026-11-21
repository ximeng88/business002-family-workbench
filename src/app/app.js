/**
 * 应用外壳（M3）：路由、双端头部、底部导航、面板与动作。
 *
 * 纪律：
 * - 所有写操作经 store.js → services；
 * - 事件委托绑在 document：底部面板渲染在 .shell 之外，绑 shell 会漏事件；
 * - 页面只渲染，不发请求；数据在 boot / reload / switchChild 时整体重载；
 * - **家长端门控**：进家长页前先看 `needsParentGate()`，配了 PIN 且本次会话没解锁就弹键盘，
 *   通过后才跳转。会话标记只在内存里，刷新即失效。
 */

import { DB_ERROR_CODES } from "../db/errors.js"
import { avatarOf, icon, subjectOf } from "./icons.js"
import { installState, onInstallChange, promptInstall, watchInstallPrompt } from "./install.js"
import { renderAssign } from "./pages/assign.js"
import { renderChildren } from "./pages/children.js"
import { renderPetPage, shopBarContent, shopSelection } from "./pages/petPage.js"
import { renderRedeem } from "./pages/redeem.js"
import { renderReview } from "./pages/review.js"
import { renderRewards } from "./pages/rewards.js"
import { renderSettings } from "./pages/settings.js"
import { renderTasks } from "./pages/tasks.js"
import {
  boot,
  clearShopPicks,
  doAcceptRedemptionBatch,
  doApprove,
  doClearParentPin,
  doCreateChild,
  doCreateReward,
  doCreateTask,
  doCreateTemplate,
  doDeleteTemplate,
  doEquipCostume,
  doExportBackup,
  doImportBackup,
  doIssueRecoveryCode,
  doReject,
  doRejectRedemptionBatch,
  doRecheckPin,
  doRequestRedemption,
  doRequestRedemptions,
  doResetPinWithRecovery,
  doSetParentPin,
  doSetRewardEnabled,
  doSetTemplateEnabled,
  doSubmit,
  doUndoRestore,
  doUnequipCostume,
  doUnlockParent,
  doUpdateReward,
  doVerifyRecoveryCode,
  doWipeAllData,
  ensureBackupOverview,
  ensureChildStats,
  loadAll,
  lockParent,
  needsParentGate,
  pendingRedemptionsOf,
  previewBackup,
  rewardById,
  state,
  submissionOf,
  switchChild,
  taskById,
  toggleShopPick,
} from "./store.js"
import {
  centerOf,
  closeSheet,
  copyText,
  countUp,
  dateKeyOffset,
  describeDateTime,
  describeRelative,
  downloadText,
  escapeHtml,
  greeting,
  isSheetOpen,
  openSheet,
  starBurst,
  toast,
} from "./ui.js"

const PAGES = {
  tasks: { mode: "kid", title: "今日任务" },
  pet: { mode: "kid", title: "团团与星星" },
  review: { mode: "parent", title: "今天要确认的" },
  redeem: { mode: "parent", title: "兑换审核" },
  rewards: { mode: "parent", title: "奖励管理" },
  assign: { mode: "parent", title: "布置新任务" },
  children: { mode: "parent", title: "孩子管理" },
  settings: { mode: "parent", title: "设置" },
}

const KID_TABS = [
  { id: "tasks", label: "今日", iconName: "sun" },
  { id: "pet", label: "团团", iconName: "paw" },
  { id: "review", label: "家长", iconName: "shield" },
]

const PARENT_TABS = [
  { id: "review", label: "确认", iconName: "shield" },
  { id: "redeem", label: "兑换", iconName: "star" },
  { id: "rewards", label: "奖励", iconName: "sparkle" },
  { id: "assign", label: "布置", iconName: "plus" },
  { id: "children", label: "孩子", iconName: "users" },
  { id: "settings", label: "设置", iconName: "gear" },
]

const QUICK_REASONS = ["再检查一遍", "说明再具体一点", "字写得再工整些"]
const QUICK_REDEEM_REASONS = ["这周先攒着", "攒够了再换", "换个更实用的"]

/** 待确认导入的备份（选了文件、还没点"覆盖并恢复"） */
let pendingImport = null

let shell = null
let topbar = null
let main = null
let dock = null
let tabbar = null

const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms))

function pendingCount() {
  return [...state.tasks, ...state.overdue].filter((task) => task.status === "submitted").length
}

/** 家长待处理的兑换申请数（跨孩子，来自 listRedemptionRequests） */
function pendingRedeemCount() {
  return state.pendingRequests.length
}

/** 底部导航角标数字：同一个 tab 只挂一种计数 */
function badgeFor(tabId) {
  if (tabId === "review") return pendingCount()
  if (tabId === "redeem") return pendingRedeemCount()
  return 0
}

/* ---------------- 头部 ---------------- */

function kidHeader() {
  const avatar = avatarOf(state.child?.avatarKey)
  const nickname = state.child?.nickname ?? "小朋友"
  return `
    <header class="topbar">
      <button class="who who--button" type="button" data-open-children aria-label="切换孩子或管理孩子">
        <span class="who__avatar" aria-hidden="true">
          <span class="who__emoji">${avatar.emoji}</span>
        </span>
        <span class="who__text">
          <span class="who__greet">${greeting()}，点这里换孩子</span>
          <span class="who__name">${escapeHtml(nickname)}${icon("chevron", { size: 13, className: "who__switch" })}</span>
        </span>
      </button>
      <button class="wallet" type="button" data-page="pet" aria-label="星星存钱罐">
        <span class="wallet__ico">${icon("starSolid", { size: 18 })}</span>
        <span class="wallet__num" data-balance>${state.balance}</span>
      </button>
    </header>`
}

function parentHeader() {
  const avatar = avatarOf(state.child?.avatarKey)
  const pending = pendingCount()
  return `
    <header class="topbar topbar--parent">
      <div class="who">
        <span class="who__avatar who__avatar--parent" aria-hidden="true">${icon("shield", { size: 20 })}</span>
        <div class="who__text">
          <p class="who__greet">家长模式 · ${avatar.emoji} ${escapeHtml(state.child?.nickname ?? "孩子")}${
            pending > 0 ? ` · ${pending} 条待确认` : ""
          }</p>
          <h1 class="who__name">${PAGES[state.page]?.title ?? "家长端"}</h1>
        </div>
      </div>
      <button class="ghost-pill ghost-pill--exit" type="button" data-exit-parent
        aria-label="退出家长模式，回到孩子端">${icon("lock", { size: 13 })}退出家长</button>
    </header>`
}

/* ---------------- 底部导航 ---------------- */

function renderTabbar(mode) {
  const tabs = mode === "parent" ? PARENT_TABS : KID_TABS
  tabbar.innerHTML = tabs.map((tab) => {
    const active = state.page === tab.id
    const count = badgeFor(tab.id)
    const badge = count > 0 ? `<span class="tab__badge">${count}</span>` : ""
    return `
      <button class="tab ${active ? "is-active" : ""}" type="button" data-page="${tab.id}"
        ${active ? 'aria-current="page"' : ""}>
        <span class="tab__ico">${icon(tab.iconName, { size: 21 })}</span>
        <span class="tab__label">${tab.label}</span>
        ${badge}
      </button>`
  }).join("")
}

/* ---------------- 渲染 ---------------- */

function paintBalance() {
  const nodes = [...document.querySelectorAll("[data-balance]")]
  const from = state.lastBalance ?? state.balance
  for (const node of nodes) countUp(node, state.balance, from)
  state.lastBalance = state.balance
}

function render({ keepScroll = false } = {}) {
  const page = PAGES[state.page] ? state.page : "tasks"
  state.page = page
  const mode = PAGES[page].mode

  document.body.dataset.mode = mode
  topbar.innerHTML = mode === "parent" ? parentHeader() : kidHeader()

  if (page === "pet") main.innerHTML = renderPetPage()
  else if (page === "review") main.innerHTML = renderReview()
  else if (page === "redeem") main.innerHTML = renderRedeem()
  else if (page === "rewards") main.innerHTML = renderRewards()
  else if (page === "assign") main.innerHTML = renderAssign()
  else if (page === "children") main.innerHTML = renderChildren()
  else if (page === "settings") main.innerHTML = renderSettings()
  else main.innerHTML = renderTasks()

  renderTabbar(mode)
  syncShopDock()
  paintBalance()
  if (!keepScroll) window.scrollTo({ top: 0, behavior: "auto" })
}

async function goPage(next) {
  if (!PAGES[next]) return
  // 门控：配了 PIN 且本次会话没解锁时，先要 4 位数字，通过后才进去
  if (PAGES[next].mode === "parent" && needsParentGate()) {
    openPinGate(next)
    return
  }
  if (isSheetOpen()) closeSheet()
  state.page = next

  if (next === "children" || (next === "review" && state.children.length > 1)) {
    try {
      await ensureChildStats()
    } catch {
      // 统计失败不阻塞页面，卡片上显示 0 即可
    }
  }

  if (next === "settings") {
    try {
      await ensureBackupOverview()
    } catch {
      // 备份概览读失败不影响设置页其他区块
    }
  }

  render()
}

/* ---------------- 家长 PIN 门控 ---------------- */

/** 退出家长模式：清掉本次会话的解锁标记（不动数据库），回到孩子端 */
function exitParentMode({ silent = false } = {}) {
  lockParent()
  if (isSheetOpen()) closeSheet()
  state.page = "tasks"
  render()
  if (!silent) toast(state.pinStatus.configured ? "已退出家长模式，再进要输 PIN" : "回到孩子端")
}

/**
 * PIN 键盘弹层。
 * 4 位数字点满自动校验；错了清空并提示还剩几次；锁定期显示倒计时。
 * @param {string} next 验证通过后要去的页面
 */
function openPinGate(next) {
  if (isSheetOpen()) closeSheet()

  const digits = []
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "back"]

  openSheet(
    `
    <div class="sheet__head">
      <span class="task__icon task__icon--lg tone-blue">${icon("lock", { size: 26 })}</span>
      <div class="sheet__heading">
        <h2 id="pin-gate-title">家长模式</h2>
        <p>输入 4 位数字，进入${escapeHtml(PAGES[next]?.title ?? "家长端")}</p>
      </div>
      <button class="sheet__close" type="button" data-sheet-close aria-label="关闭">${icon("close", { size: 20 })}</button>
    </div>

    <div class="pin-gate" data-pin-gate>
      <div class="pin-dots" data-pin-dots aria-live="polite">
        ${[0, 1, 2, 3].map(() => `<span class="pin-dot"></span>`).join("")}
      </div>
      <p class="pin-gate__msg" data-pin-msg>PIN 只是防误触，不是密码</p>

      <div class="keypad" role="group" aria-label="数字键盘">
        ${keys
          .map((key) => {
            if (key === "clear") {
              return `<button class="keypad__key keypad__key--ghost" type="button" data-pin-clear>清空</button>`
            }
            if (key === "back") {
              return `<button class="keypad__key keypad__key--ghost" type="button" data-pin-back
                aria-label="删掉一位">${icon("undo", { size: 18 })}</button>`
            }
            return `<button class="keypad__key" type="button" data-pin-key="${key}">${key}</button>`
          })
          .join("")}
      </div>
    </div>

    <button class="pin-gate__forgot" type="button" data-forgot-pin="${escapeHtml(next)}">
      ${icon("key", { size: 15 })}忘记 PIN 了？用恢复码重置
    </button>
    <button class="btn btn--ghost btn--block" type="button" data-sheet-close>先不进了</button>`,
    {
      labelledBy: "pin-gate-title",
      onMount(panel) {
        const gate = panel.querySelector("[data-pin-gate]")
        const dots = [...panel.querySelectorAll(".pin-dot")]
        const msg = panel.querySelector("[data-pin-msg]")
        let busy = false

        const paint = () => {
          dots.forEach((dot, index) => dot.classList.toggle("is-filled", index < digits.length))
        }
        const say = (text, tone = "") => {
          if (!msg) return
          msg.textContent = text
          msg.className = `pin-gate__msg${tone ? ` is-${tone}` : ""}`
        }
        const shake = () => {
          gate?.classList.add("is-shake")
          window.setTimeout(() => gate?.classList.remove("is-shake"), 420)
        }

        const submit = async () => {
          if (busy) return
          busy = true
          const pin = digits.join("")
          let result
          try {
            result = await doUnlockParent({ pin })
          } catch {
            busy = false
            digits.length = 0
            paint()
            shake()
            say("校验出错了，再试一次", "warn")
            return
          }

          if (result.allowed) {
            closeSheet()
            toast("欢迎回来，家长")
            await goPage(next)
            return
          }

          busy = false
          digits.length = 0
          paint()
          shake()
          if (result.reason === "locked") {
            const seconds = Math.ceil((result.retryAfterMs ?? 0) / 1000)
            say(`输错太多次，等 ${seconds} 秒再试`, "warn")
          } else if (typeof result.remainingAttempts === "number") {
            say(`PIN 不对，还能试 ${result.remainingAttempts} 次`, "warn")
          } else {
            say("PIN 不对，再想一下", "warn")
          }
        }

        const push = (digit) => {
          if (busy || digits.length >= 4) return
          digits.push(digit)
          paint()
          if (digits.length === 4) window.setTimeout(() => void submit(), 140)
        }

        for (const key of panel.querySelectorAll("[data-pin-key]")) {
          key.addEventListener("click", () => push(key.dataset.pinKey))
        }
        panel.querySelector("[data-pin-back]")?.addEventListener("click", () => {
          if (busy) return
          digits.pop()
          paint()
          say("PIN 只是防误触，不是密码")
        })
        panel.querySelector("[data-pin-clear]")?.addEventListener("click", () => {
          if (busy) return
          digits.length = 0
          paint()
        })
        panel.addEventListener("keydown", (event) => {
          if (/^\d$/.test(event.key)) {
            push(event.key)
            event.preventDefault()
          } else if (event.key === "Backspace") {
            digits.pop()
            paint()
            event.preventDefault()
          }
        })
        paint()
      },
    },
  )
}

/* ---------------- 面板：任务 ---------------- */

function openTaskSheet(taskId) {
  const task = taskById(taskId)
  if (!task) return

  if (task.status === "submitted") {
    openStatusSheet(task, {
      iconName: "clock",
      tone: "blue",
      title: "已经交上去啦",
      sub: "等爸爸妈妈看一眼，通过了星星就到账",
    })
    return
  }
  if (task.status === "approved") {
    openStatusSheet(task, {
      iconName: "trophy",
      tone: "green",
      title: "这件已经完成",
      sub: `+${task.points} 颗星星已经进口袋了`,
    })
    return
  }

  const subject = subjectOf(task.title)
  const isRevision = task.status === "revision"
  const prefill = isRevision ? String(submissionOf(task.id)?.content ?? "") : ""
  const reason = isRevision && task.revisionReason ? task.revisionReason : ""

  openSheet(
    `
    <div class="sheet__head">
      <span class="task__icon task__icon--lg tone-${subject.tone}">${icon(subject.iconName, { size: 30 })}</span>
      <div class="sheet__heading">
        <h2 id="sheet-title">${escapeHtml(task.title)}</h2>
        <p>${isRevision ? "改好再交一次，星星还等着你" : `完成后可以得到 <b>${task.points}</b> 颗星星`}</p>
      </div>
      <button class="sheet__close" type="button" data-sheet-close aria-label="关闭">${icon("close", { size: 20 })}</button>
    </div>
    ${
      reason
        ? `<p class="sheet__note">${icon("info", { size: 15 })}<span>家长说：${escapeHtml(reason)}</span></p>`
        : isRevision
          ? `<p class="sheet__note">${icon("info", { size: 15 })}<span>家长希望你再看一遍，改好可以重新交</span></p>`
          : ""
    }
    <form class="sheet__form" data-submit-task="${escapeHtml(task.id)}" novalidate>
      <label class="sheet__label" for="sheet-content">${
        isRevision ? "说说这次改了什么" : "跟爸爸妈妈说说你做了什么"
      }</label>
      <div class="field">
        <textarea id="sheet-content" name="content" rows="3" maxlength="120"
          placeholder="${
            isRevision ? "例如：我补上了读了第 8 课，读了三遍" : "例如：我把语文书和数学书都装进书包了"
          }">${escapeHtml(prefill)}</textarea>
        <span class="field__count"><b data-count>${prefill.length}</b>/120</span>
      </div>
      <button class="btn btn--primary btn--xl" type="submit">
        ${isRevision ? "改好了，再交一次" : "我做完啦"}${icon("starSolid", { size: 18 })}
      </button>
    </form>`,
    {
      labelledBy: "sheet-title",
      onMount(panel) {
        const textarea = panel.querySelector("#sheet-content")
        const counter = panel.querySelector("[data-count]")
        textarea?.addEventListener("input", () => {
          if (counter) counter.textContent = String(textarea.value.length)
        })
        window.setTimeout(() => {
          textarea?.focus({ preventScroll: true })
          textarea?.setSelectionRange(textarea.value.length, textarea.value.length)
        }, 320)
      },
    },
  )
}

function openStatusSheet(task, { iconName, tone, title, sub }) {
  const submission = submissionOf(task.id)
  openSheet(
    `
    <div class="sheet__head">
      <span class="task__icon task__icon--lg tone-${tone}">${icon(iconName, { size: 28 })}</span>
      <div class="sheet__heading">
        <h2 id="status-title">${escapeHtml(task.title)}</h2>
        <p>${escapeHtml(sub)}</p>
      </div>
      <button class="sheet__close" type="button" data-sheet-close aria-label="关闭">${icon("close", { size: 20 })}</button>
    </div>
    ${
      submission
        ? `<p class="sheet__label">${escapeHtml(title)}</p>
           <blockquote class="review__quote review__quote--sheet">
             <span class="review__quote-mark" aria-hidden="true">“</span>${escapeHtml(submission.content)}
           </blockquote>`
        : ""
    }
    <button class="btn btn--ghost btn--block" type="button" data-sheet-close>知道了</button>`,
    { labelledBy: "status-title" },
  )
}

/* ---------------- 面板：退回 ---------------- */

function openRejectSheet(taskId) {
  const task = taskById(taskId)
  if (!task) return
  const submission = submissionOf(taskId)

  openSheet(
    `
    <div class="sheet__head">
      <span class="task__icon task__icon--lg tone-pink">${icon("undo", { size: 26 })}</span>
      <div class="sheet__heading">
        <h2 id="reject-title">退回「${escapeHtml(task.title)}」</h2>
        <p>退回不扣星星，任务会回到孩子的「需要改一下」</p>
      </div>
      <button class="sheet__close" type="button" data-sheet-close aria-label="关闭">${icon("close", { size: 20 })}</button>
    </div>
    ${
      submission
        ? `<blockquote class="review__quote review__quote--sheet">
             <span class="review__quote-mark" aria-hidden="true">“</span>${escapeHtml(submission.content)}
           </blockquote>`
        : ""
    }
    <form class="sheet__form" data-reject-form="${escapeHtml(taskId)}" novalidate>
      <label class="sheet__label" for="reject-reason">想让孩子改什么（可以不填）</label>
      <div class="field">
        <textarea id="reject-reason" name="reason" rows="2" maxlength="60"
          placeholder="例如：说明里没写读了哪一课"></textarea>
        <span class="field__count"><b data-count>0</b>/60</span>
      </div>
      <div class="reason-chips">
        ${QUICK_REASONS.map(
          (reason) => `<button class="reason-chip" type="button" data-reason="${escapeHtml(reason)}">${escapeHtml(reason)}</button>`,
        ).join("")}
      </div>
      <button class="btn btn--reject btn--block" type="submit">退回让孩子改</button>
    </form>`,
    {
      labelledBy: "reject-title",
      onMount(panel) {
        const textarea = panel.querySelector("#reject-reason")
        const counter = panel.querySelector("[data-count]")
        for (const chip of panel.querySelectorAll("[data-reason]")) {
          chip.addEventListener("click", () => {
            if (!textarea) return
            textarea.value = chip.dataset.reason ?? ""
            if (counter) counter.textContent = String(textarea.value.length)
            textarea.focus({ preventScroll: true })
          })
        }
        textarea?.addEventListener("input", () => {
          if (counter) counter.textContent = String(textarea.value.length)
        })
      },
    },
  )
}

/* ---------------- 面板：换孩子 ---------------- */

async function openChildSwitcher() {
  try {
    await ensureChildStats()
  } catch {
    // 统计失败仍然允许切换
  }

  const rows = state.children
    .map((child) => {
      const avatar = avatarOf(child.avatarKey)
      const stat = state.childStats.find((row) => row.id === child.id)
      const active = child.id === state.childId
      const pending = stat?.pending ?? 0
      return `
        <button class="switch-item ${active ? "is-active" : ""}" type="button" data-switch-child="${escapeHtml(child.id)}">
          <span class="switch-item__avatar">${avatar.emoji}</span>
          <span class="switch-item__body">
            <strong>${escapeHtml(child.nickname)}</strong>
            <small>今天 ${stat?.approved ?? 0}/${stat?.todayTotal ?? 0} 完成${
              pending ? ` · 待确认 ${pending}` : ""
            }</small>
          </span>
          ${active ? `<span class="switch-item__now">${icon("check", { size: 16, strokeWidth: 2.6 })}使用中</span>` : icon("chevron", { size: 16 })}
        </button>`
    })
    .join("")

  openSheet(
    `
    <div class="sheet__head">
      <span class="task__icon task__icon--lg tone-orange">${icon("users", { size: 26 })}</span>
      <div class="sheet__heading">
        <h2 id="switch-title">换一个孩子</h2>
        <p>每个孩子的任务、星星、宠物经验分开记录</p>
      </div>
      <button class="sheet__close" type="button" data-sheet-close aria-label="关闭">${icon("close", { size: 20 })}</button>
    </div>
    <div class="switch-list">${rows}</div>
    ${
      state.children.length <= 1
        ? `<p class="switch-hint">现在只有 ${escapeHtml(state.child?.nickname ?? "一个孩子")}，去家长端可以再加一个。</p>`
        : ""
    }
    <button class="btn btn--ghost btn--block" type="button" data-page="children">管理孩子 / 添加孩子</button>`,
    { labelledBy: "switch-title" },
  )
}

/* ---------------- 动作 ---------------- */

async function handleSubmit(form) {
  if (state.busy) return
  const taskId = form.dataset.submitTask
  const task = taskById(taskId)
  const content = String(new FormData(form).get("content") ?? "")
  const button = form.querySelector('button[type="submit"]')
  const isRevision = task?.status === "revision"

  if (content.trim() === "") {
    form.querySelector("textarea")?.focus()
    toast("先写一句完成说明呀", "warn")
    return
  }

  state.busy = { taskId, action: "submit" }
  const idleHtml = button ? button.innerHTML : ""
  if (button) {
    button.disabled = true
    button.innerHTML = "正在交给爸爸妈妈…"
  }
  form.querySelector("textarea")?.setAttribute("readonly", "readonly")

  try {
    await doSubmit({ taskId, content })
  } catch (error) {
    state.busy = null
    if (button) {
      button.disabled = false
      button.innerHTML = idleHtml
    }
    form.querySelector("textarea")?.removeAttribute("readonly")
    toast(
      error?.code === DB_ERROR_CODES.VALIDATION_FAILED
        ? "这条任务现在不能提交，刷新看看最新状态"
        : "这次没交上，再点一次试试",
      "warn",
    )
    return
  }

  const origin = centerOf(button)
  closeSheet()
  if (origin) starBurst(origin.x, origin.y, 9)
  toast(
    isRevision
      ? `「${task?.title ?? "任务"}」又交上去啦，等爸爸妈妈再点头`
      : `「${task?.title ?? "任务"}」交上去啦，等爸爸妈妈点头`,
  )

  await reload()
}

async function handleApprove(taskId, button) {
  if (state.busy) return
  const task = taskById(taskId)
  const card = button.closest(".review")
  const actions = card ? [...card.querySelectorAll("button")] : []
  const origin = centerOf(button)

  state.busy = { taskId, action: "approve" }
  card?.classList.add("is-busy")
  for (const control of actions) control.disabled = true
  button.textContent = "正在通过…"

  let result
  try {
    result = await doApprove({ taskId })
  } catch {
    state.busy = null
    card?.classList.remove("is-busy")
    for (const control of actions) control.disabled = false
    button.textContent = button.dataset.idleLabel ?? "通过"
    toast("这次没成功，再点一次", "warn")
    return
  }

  if (result.status === "approved") {
    card?.classList.add("is-approved")
    if (origin) starBurst(origin.x, origin.y, 14)
    toast(`通过啦 · ${task?.title ?? "任务"} +${result.points} 星，团团 +${result.exp} 经验`)
    await sleep(280)
  } else if (result.status === "duplicate" || result.status === "already-approved") {
    toast("这条已经审核过了，不会重复加分", "info")
  }

  await reload()
}

async function handleRejectSubmit(form) {
  if (state.busy) return
  const taskId = form.dataset.rejectForm
  const task = taskById(taskId)
  const reason = String(new FormData(form).get("reason") ?? "")
  const button = form.querySelector('button[type="submit"]')
  const idleHtml = button ? button.innerHTML : ""

  state.busy = { taskId, action: "reject" }
  if (button) {
    button.disabled = true
    button.innerHTML = "正在退回…"
  }

  try {
    await doReject({ taskId, reason })
  } catch (error) {
    state.busy = null
    if (button) {
      button.disabled = false
      button.innerHTML = idleHtml
    }
    toast(
      error?.code === DB_ERROR_CODES.VALIDATION_FAILED
        ? "这条任务现在不能退回，刷新看看最新状态"
        : "这次没退回成功，再点一次",
      "warn",
    )
    return
  }

  closeSheet()
  toast(
    reason.trim()
      ? `已退回「${task?.title ?? "任务"}」，孩子会看到你的话`
      : `已退回「${task?.title ?? "任务"}」，等孩子改完重交`,
    "info",
  )

  await reload()
}

async function handleAssign(form) {
  if (state.busy) return
  const data = new FormData(form)
  const title = String(data.get("title") ?? "").trim()
  const childId = String(data.get("childId") ?? state.childId)
  const dueDate = String(data.get("dueDate") ?? dateKeyOffset(0))
  const points = Number(data.get("points"))
  const repeat = String(data.get("repeat") ?? "none")
  const weekdays = String(data.get("weekdays") ?? "")
    .split(",")
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value >= 0 && value <= 6)
  const button = form.querySelector('button[type="submit"]')
  const idleHtml = button ? button.innerHTML : ""

  const titleInput = form.querySelector('input[name="title"]')
  if (!title) {
    titleInput?.focus()
    toast("给这件事起个名字吧", "warn")
    return
  }
  if (!Number.isInteger(points) || points < 0) {
    toast("星星数不对，再调一下", "warn")
    return
  }
  if (repeat === "weekly" && weekdays.length === 0) {
    toast("「每周几」要选至少一个星期一", "warn")
    form.querySelector("[data-weekday-picker]")?.scrollIntoView({ block: "center", behavior: "smooth" })
    return
  }

  state.busy = { action: "assign" }
  if (button) {
    button.disabled = true
    button.innerHTML = repeat === "none" ? "正在布置…" : "正在设为固定…"
  }

  try {
    if (repeat === "none") {
      await doCreateTask({ childId, title, points, dueDate })
    } else {
      await doCreateTemplate({
        title,
        points,
        type: repeat === "weekly" ? "weekly" : "daily",
        childIds: [childId],
        weekdays,
      })
    }
  } catch (error) {
    state.busy = null
    if (button) {
      button.disabled = false
      button.innerHTML = idleHtml
    }
    toast(
      error?.code === DB_ERROR_CODES.VALIDATION_FAILED
        ? error.message || "这条任务没能布置成功，检查一下名字和星星数"
        : "写库失败，再试一次",
      "warn",
    )
    return
  }

  toast(
    repeat === "none"
      ? `布置好了 · ${title} +${points} 星`
      : `固定任务已建好 · ${title} ${repeat === "daily" ? "每天" : "每周"}都出现 +${points} 星`,
    "ok",
  )
  await reload()
}

async function handleAddChild(form) {
  if (state.busy) return
  const data = new FormData(form)
  const nickname = String(data.get("nickname") ?? "").trim()
  const avatarKey = String(data.get("avatarKey") ?? "cat")
  const button = form.querySelector('button[type="submit"]')
  const idleHtml = button ? button.innerHTML : ""

  if (!nickname) {
    form.querySelector('input[name="nickname"]')?.focus()
    toast("先写一个昵称", "warn")
    return
  }

  state.busy = { action: "add-child" }
  if (button) {
    button.disabled = true
    button.innerHTML = "正在添加…"
  }

  let child
  try {
    child = await doCreateChild({ nickname, avatarKey })
  } catch (error) {
    state.busy = null
    if (button) {
      button.disabled = false
      button.innerHTML = idleHtml
    }
    toast(error?.message ?? "添加失败，再试一次", "warn")
    return
  }

  state.busy = null
  try {
    await ensureChildStats()
  } catch {
    // 忽略统计失败
  }
  render()
  toast(`添加了 ${child.nickname}，已经切换到他`, "ok")
}

function assignDraft() {
  if (state.page !== "assign") return null
  return {
    title: document.getElementById("assign-title")?.value ?? "",
    points: document.querySelector("[data-points-input]")?.value ?? "10",
    dueDate: document.querySelector("[data-due-input]")?.value ?? dateKeyOffset(0),
  }
}

function restoreAssignDraft(draft) {
  if (!draft || state.page !== "assign") return
  const titleInput = document.getElementById("assign-title")
  if (titleInput) titleInput.value = draft.title

  const pointsInput = document.querySelector("[data-points-input]")
  const pointsView = document.querySelector("[data-points-value]")
  if (pointsInput) pointsInput.value = draft.points
  if (pointsView) pointsView.textContent = draft.points

  const dueInput = document.querySelector("[data-due-input]")
  if (dueInput) dueInput.value = draft.dueDate
  for (const button of document.querySelectorAll("[data-due-offset]")) {
    button.classList.toggle(
      "is-active",
      dateKeyOffset(Number(button.dataset.dueOffset) || 0) === draft.dueDate,
    )
  }
}

async function handleSwitchChild(childId) {
  if (state.busy) return
  if (childId === state.childId) {
    if (isSheetOpen()) closeSheet()
    return
  }

  const draft = assignDraft()

  state.busy = { action: "switch-child" }
  try {
    await switchChild(childId)
  } catch {
    state.busy = null
    toast("切换失败，刷新页面再试", "warn")
    return
  }
  state.busy = null

  if (isSheetOpen()) closeSheet()
  if (state.page === "children") {
    try {
      await ensureChildStats()
    } catch {
      // 忽略
    }
  }
  render()
  restoreAssignDraft(draft)
  toast(`现在是 ${state.child?.nickname ?? "新的孩子"}`)
}

async function reload() {
  try {
    await loadAll()
  } catch {
    state.busy = null
    toast("数据读取出错，请刷新页面", "warn")
    return
  }

  if (state.page === "children" || (state.page === "review" && state.children.length > 1)) {
    try {
      await ensureChildStats()
    } catch {
      // 忽略统计失败
    }
  }

  state.busy = null
  render()
}

/* ---------------- 面板：奖励改价 ---------------- */

function openRewardSheet(rewardId) {
  const reward = rewardById(rewardId)
  if (!reward) return
  const isBuiltin = reward.source === "builtin"
  const step = 5

  openSheet(
    `
    <div class="sheet__head">
      <span class="task__icon task__icon--lg tone-orange">${icon(reward.iconKey || "sparkle", { size: 26 })}</span>
      <div class="sheet__heading">
        <h2 id="reward-title">${escapeHtml(reward.name)}</h2>
        <p>${isBuiltin ? "内置奖励只能改积分和启停" : "自定义奖励可以改名称、说明和积分"}</p>
      </div>
      <button class="sheet__close" type="button" data-sheet-close aria-label="关闭">${icon("close", { size: 20 })}</button>
    </div>

    <form class="sheet__form" data-reward-edit-form="${escapeHtml(reward.id)}" novalidate>
      ${
        isBuiltin
          ? ""
          : `<label class="sheet__label" for="reward-edit-name">叫什么</label>
             <div class="field field--single">
               <input id="reward-edit-name" name="name" maxlength="12" value="${escapeHtml(reward.name)}" />
             </div>
             <label class="sheet__label" for="reward-edit-desc">一句话说明</label>
             <div class="field field--single">
               <input id="reward-edit-desc" name="description" maxlength="20" value="${escapeHtml(reward.description ?? "")}" />
             </div>`
      }

      <label class="sheet__label">要多少星星</label>
      <div class="form-row form-row--bare">
        <span class="points-view points-view--lg"><b data-edit-cost-value>${reward.cost}</b> 颗</span>
        <div class="stepper stepper--compact">
          <button class="stepper__btn" type="button" data-edit-cost-step="-${step}" aria-label="减少 ${step} 颗">−</button>
          <button class="stepper__btn" type="button" data-edit-cost-step="${step}" aria-label="增加 ${step} 颗">＋</button>
        </div>
      </div>
      <input type="hidden" name="cost" value="${reward.cost}" data-edit-cost-input />
      <p class="sheet__hint">${
        Number.isInteger(reward.defaultCost)
          ? `系统建议 ${reward.defaultCost} 颗；改价只影响之后的新申请，已经申请的按当时的价格。`
          : "改价只影响之后的新申请，已经申请的按当时的价格。"
      }</p>

      <button class="btn btn--primary btn--xl" type="submit">保存</button>
    </form>`,
    {
      labelledBy: "reward-title",
      onMount(panel) {
        const input = panel.querySelector("[data-edit-cost-input]")
        const view = panel.querySelector("[data-edit-cost-value]")
        for (const button of panel.querySelectorAll("[data-edit-cost-step]")) {
          button.addEventListener("click", () => {
            if (!input) return
            const next = Math.min(300, Math.max(1, (Number(input.value) || 10) + Number(button.dataset.editCostStep)))
            input.value = String(next)
            if (view) view.textContent = String(next)
          })
        }
      },
    },
  )
}

/* ---------------- 面板：退回兑换（整批） ---------------- */

function openRejectRedemptionSheet(batchId) {
  const rows = state.pendingRequests.filter((row) => (row.batchId ?? row.id) === batchId)
  if (!rows.length) return
  const bulk = rows.length > 1
  const child = rows[0].child
  const nickname = escapeHtml(child?.nickname ?? "孩子")
  const names = rows.map((row) => `「${escapeHtml(row.rewardNameSnapshot)}」`).join("")

  openSheet(
    `
    <div class="sheet__head">
      <span class="task__icon task__icon--lg tone-pink">${icon("undo", { size: 26 })}</span>
      <div class="sheet__heading">
        <h2 id="redeem-reject-title">${
          bulk ? `先不换这批（${rows.length} 件）` : `先不换${names}`
        }</h2>
        <p>拒绝不扣星星，${nickname}会看到你的说明</p>
      </div>
      <button class="sheet__close" type="button" data-sheet-close aria-label="关闭">${icon("close", { size: 20 })}</button>
    </div>
    ${
      bulk
        ? `<ul class="sheet__summary">${rows
            .map(
              (row) =>
                `<li><span>${escapeHtml(row.rewardNameSnapshot)}</span><b>${row.costSnapshot} 颗</b></li>`,
            )
            .join("")}</ul>`
        : ""
    }
    <form class="sheet__form" data-reject-batch-form="${escapeHtml(batchId)}" novalidate>
      <label class="sheet__label" for="redeem-reason">想跟孩子说什么（可以不填）</label>
      <div class="field">
        <textarea id="redeem-reason" name="parentMessage" rows="2" maxlength="40"
          placeholder="例如：这周先攒着，下周再换"></textarea>
        <span class="field__count"><b data-count>0</b>/40</span>
      </div>
      <div class="reason-chips">
        ${QUICK_REDEEM_REASONS.map(
          (reason) => `<button class="reason-chip" type="button" data-redeem-reason="${escapeHtml(reason)}">${escapeHtml(reason)}</button>`,
        ).join("")}
      </div>
      <button class="btn btn--reject btn--block" type="submit">${bulk ? "这批都先不换" : "先不换了"}</button>
    </form>`,
    {
      labelledBy: "redeem-reject-title",
      onMount(panel) {
        const textarea = panel.querySelector("#redeem-reason")
        const counter = panel.querySelector("[data-count]")
        for (const chip of panel.querySelectorAll("[data-redeem-reason]")) {
          chip.addEventListener("click", () => {
            if (!textarea) return
            textarea.value = chip.dataset.redeemReason ?? ""
            if (counter) counter.textContent = String(textarea.value.length)
            textarea.focus({ preventScroll: true })
          })
        }
        textarea?.addEventListener("input", () => {
          if (counter) counter.textContent = String(textarea.value.length)
        })
      },
    },
  )
}

/* ---------------- 动作：商城勾选 / 批量提交 ---------------- */

/**
 * 底部汇总条挂在 `.page` 之外的 `#dock` 上。
 * `.page` 带着 rise-in 动画（transform 未归零），会成为 position:fixed 的包含块，
 * 放在页面里就会被"贴着页面底部"排到视口外。
 */
function syncShopDock() {
  if (!dock) return
  if (state.page !== "pet") {
    dock.innerHTML = ""
    return
  }

  const { count } = shopSelection()
  let bar = dock.querySelector("[data-shop-bar]")
  if (!bar) {
    bar = document.createElement("div")
    bar.className = "shop-bar"
    bar.dataset.shopBar = ""
    dock.appendChild(bar)
  }
  bar.innerHTML = shopBarContent()
  bar.hidden = count === 0
  document.querySelector(".page--pet")?.classList.toggle("has-shop-bar", count > 0)
}

/** 只重画底部汇总条，不整页重渲染（避免卡片入场动画每次勾选都重放） */
function paintShopBar() {
  syncShopDock()
}

function paintShopCard(button, picked) {
  const card = button.closest(".shop-card")
  card?.classList.toggle("is-picked", picked)
  button.classList.toggle("shop-btn--picked", picked)
  button.classList.toggle("shop-btn--pick", !picked)
  button.setAttribute("aria-pressed", String(picked))
  button.innerHTML = picked
    ? `${icon("check", { size: 14, strokeWidth: 2.8 })}已选`
    : "选这个"

  const art = card?.querySelector(".shop-card__art")
  if (!art) return
  const existing = art.querySelector(".shop-card__check")
  if (picked && !existing) {
    const mark = document.createElement("span")
    mark.className = "shop-card__check"
    mark.setAttribute("aria-hidden", "true")
    mark.innerHTML = icon("check", { size: 11, strokeWidth: 3.2 })
    art.appendChild(mark)
  } else if (!picked && existing) {
    existing.remove()
  }
}

/** 点一下卡片 = 加进 / 移出清单，不落库、不打扰家长 */
function handlePickReward(button) {
  if (state.busy || pendingRedemptionsOf().length) return
  const rewardId = button.dataset.pickReward
  if (!rewardId) return
  const picked = toggleShopPick(rewardId)
  paintShopCard(button, picked.includes(rewardId))
  paintShopBar()
}

async function handleClearPicks() {
  clearShopPicks()
  render({ keepScroll: true })
}

/** 把勾选的多件一次提交成一个批次 */
async function handleSubmitBatch(button) {
  if (state.busy) return
  const selection = shopSelection()
  if (!selection.count) return
  if (selection.shortage) {
    toast(`还差 ${selection.shortage} 颗星星，先去做任务攒一攒`, "warn")
    return
  }

  const idleHtml = button.innerHTML
  const origin = centerOf(button)
  state.busy = { action: "request-batch", rewardIds: selection.ids }
  button.disabled = true
  button.textContent = "正在告诉爸爸妈妈…"

  let result
  try {
    result = await doRequestRedemptions({ rewardIds: selection.ids })
  } catch (error) {
    state.busy = null
    button.disabled = false
    button.innerHTML = idleHtml
    toast(
      error?.code === DB_ERROR_CODES.VALIDATION_FAILED
        ? error.message || "这批现在换不了，刷新看看"
        : "这次没申请上，再点一次试试",
      "warn",
    )
    return
  }

  if (origin) starBurst(origin.x, origin.y, 14)
  const count = result.records.length
  toast(
    count > 1
      ? `已经告诉爸爸妈妈啦 · ${count} 件共 ${result.totalCost} 颗`
      : `已经告诉爸爸妈妈啦 · ${result.records[0].rewardNameSnapshot}`,
    "ok",
  )
  await reload()
}

async function handleRequestRedemption(button) {
  if (state.busy) return
  const rewardId = button.dataset.requestReward
  const reward = rewardById(rewardId)
  const idleLabel = button.dataset.idleLabel ?? button.textContent

  // 星星不够就挡在孩子端：只提示，不发申请，不打扰家长
  if (reward && state.balance < reward.cost) {
    toast(`还差 ${reward.cost - state.balance} 颗星星，先去做任务攒一攒`, "warn")
    return
  }

  state.busy = { action: "request-redemption", rewardId }
  button.disabled = true
  button.textContent = "正在告诉爸爸妈妈…"

  try {
    await doRequestRedemption({ rewardId })
  } catch (error) {
    state.busy = null
    button.disabled = false
    button.textContent = idleLabel
    toast(
      error?.code === DB_ERROR_CODES.VALIDATION_FAILED
        ? error.message || "这个现在换不了，刷新看看"
        : "这次没申请上，再点一次试试",
      "warn",
    )
    return
  }

  toast(`已经告诉爸爸妈妈啦 · ${reward?.name ?? "奖励"}`, "ok")
  await reload()
}

/* ---------------- 动作：家长按批确认 / 退回 ---------------- */

/** 取消勾一件：卡片上的数字、警告、按钮文案跟着重算，不整页重渲染 */
function toggleBatchItem(button) {
  const card = button.closest("[data-batch-card]")
  const row = button.closest("[data-batch-row]")
  if (!card || !row) return
  const off = row.classList.toggle("is-off")
  button.setAttribute("aria-pressed", String(!off))
  recalcBatchCard(card)
}

function recalcBatchCard(card) {
  const rows = [...card.querySelectorAll("[data-batch-row]")]
  const chosen = rows.filter((row) => !row.classList.contains("is-off"))
  const balanceNode = card.querySelector("[data-batch-left]")
  const balance = Number(balanceNode?.dataset.batchBalance ?? 0)
  const total = chosen.reduce((sum, row) => sum + (Number(row.dataset.cost) || 0), 0)
  const shortage = Math.max(0, total - balance)
  const bulk = rows.length > 1

  const countNode = card.querySelector("[data-batch-count]")
  const totalNode = card.querySelector("[data-batch-total]")
  if (countNode) countNode.textContent = `${chosen.length} 件`
  if (totalNode) totalNode.textContent = `${total} 颗`

  if (balanceNode) {
    balanceNode.classList.toggle("is-short", shortage > 0)
    balanceNode.textContent = shortage ? `还差 ${shortage} 颗` : `${balance - total} 颗`
  }

  const warn = card.querySelector("[data-batch-warn]")
  const warnText = card.querySelector("[data-batch-warn-text]")
  if (warn) warn.hidden = shortage === 0
  if (warnText) {
    warnText.textContent = shortage
      ? `按现在勾选的件，还差 ${shortage} 颗。再取消一件，或让孩子先攒攒。`
      : ""
  }

  const accept = card.querySelector("[data-accept-batch]")
  if (!accept) return
  const label =
    chosen.length === 0
      ? "至少留一件"
      : bulk
        ? `通过 ${chosen.length} 件 · 扣 ${total} 颗`
        : `通过并扣 ${total} 颗`
  accept.textContent = label
  accept.dataset.idleLabel = label
  accept.disabled = chosen.length === 0 || shortage > 0
}

async function handleAcceptBatch(batchId, button) {
  if (state.busy) return
  const card = button.closest("[data-batch-card]")
  const rows = card ? [...card.querySelectorAll("[data-batch-row]")] : []
  // 单件卡不列明细行，id 从卡片上的 data-batch-ids 取
  const acceptedIds = rows.length
    ? rows.filter((row) => !row.classList.contains("is-off")).map((row) => row.dataset.redemptionId)
    : String(card?.dataset.batchIds ?? "")
        .split(",")
        .filter(Boolean)
  if (!acceptedIds.length) {
    toast("至少留一件再通过，或者整批先不换", "warn")
    return
  }

  const controls = card ? [...card.querySelectorAll("button")] : []
  const origin = centerOf(button)
  const idleLabel = button.dataset.idleLabel ?? "通过"

  state.busy = { action: "accept-batch", batchId }
  card?.classList.add("is-busy")
  for (const control of controls) control.disabled = true
  button.textContent = "正在确认…"

  let result
  try {
    result = await doAcceptRedemptionBatch({ batchId, acceptedIds })
  } catch (error) {
    state.busy = null
    card?.classList.remove("is-busy")
    for (const control of controls) control.disabled = false
    button.textContent = idleLabel
    toast(
      error?.code === DB_ERROR_CODES.VALIDATION_FAILED
        ? error.message || "这批现在不能确认"
        : "这次没确认成功，再点一次",
      "warn",
    )
    await reload()
    return
  }

  if (result.status === "accepted") {
    card?.classList.add("is-approved")
    if (origin) starBurst(origin.x, origin.y, 12)
    const count = result.accepted.length
    const word = count > 1 ? `${count} 件` : result.accepted[0]?.rewardName ?? "奖励"
    const tail = result.rejected.length ? `，另外 ${result.rejected.length} 件已退回` : ""
    toast(`换好啦 · ${word} −${result.totalCost} 星，剩 ${result.balanceAfter} 星${tail}`, "ok")
    await sleep(240)
  } else {
    toast("这批已经处理过了，不会重复扣星星", "info")
  }

  await reload()
}

async function handleRejectBatchSubmit(form) {
  if (state.busy) return
  const batchId = form.dataset.rejectBatchForm
  const parentMessage = String(new FormData(form).get("parentMessage") ?? "")
  const button = form.querySelector('button[type="submit"]')
  const idleHtml = button ? button.innerHTML : ""

  state.busy = { action: "reject-batch", batchId }
  if (button) {
    button.disabled = true
    button.innerHTML = "正在退回…"
  }

  let result
  try {
    result = await doRejectRedemptionBatch({ batchId, parentMessage })
  } catch (error) {
    state.busy = null
    if (button) {
      button.disabled = false
      button.innerHTML = idleHtml
    }
    toast(
      error?.code === DB_ERROR_CODES.VALIDATION_FAILED
        ? error.message || "这批现在不能退回"
        : "这次没处理成功，再点一次",
      "warn",
    )
    return
  }

  closeSheet()
  const count = result.rejected?.length ?? 0
  toast(
    count > 1 ? `已经告诉孩子这批先不换了，${count} 件一起退回，星星一颗没动` : "已经告诉孩子先不换了，星星一颗没动",
    "info",
  )
  await reload()
}

async function handleEquipCostume(costumeKey, button) {
  if (state.busy) return
  state.busy = { action: "equip", costumeKey }
  if (button) button.disabled = true

  try {
    const result = await doEquipCostume({ costumeKey })
    state.costume = { ...state.costume, worn: result.worn }
  } catch (error) {
    state.busy = null
    if (button) button.disabled = false
    toast(error?.message || "这次没换上，再点一次", "warn")
    return
  }

  state.busy = null
  render({ keepScroll: true })
  toast("换好啦，团团看起来不一样了", "ok")
}

async function handleUnequipCostume(slot, button) {
  if (state.busy) return
  state.busy = { action: "unequip", slot }
  if (button) button.disabled = true

  try {
    const result = await doUnequipCostume({ slot })
    state.costume = { ...state.costume, worn: result.worn }
  } catch (error) {
    state.busy = null
    if (button) button.disabled = false
    toast("这次没卸下，再点一次", "warn")
    return
  }

  state.busy = null
  render({ keepScroll: true })
  toast("已经卸下来了", "info")
}

/* ---------------- 动作：奖励管理 ---------------- */

async function handleToggleReward(button) {
  if (state.busy) return
  const rewardId = button.dataset.toggleReward
  const enabled = button.dataset.enabled === "true"
  const reward = rewardById(rewardId)

  state.busy = { action: "toggle-reward", rewardId }
  button.disabled = true

  try {
    await doSetRewardEnabled({ rewardId, enabled })
  } catch (error) {
    state.busy = null
    button.disabled = false
    toast(error?.message || "这次没改成功，再试一次", "warn")
    return
  }

  state.busy = null
  render({ keepScroll: true })
  toast(
    enabled
      ? `「${reward?.name ?? "奖励"}」已启用，孩子可以申请了`
      : `「${reward?.name ?? "奖励"}」已停用，孩子端不再显示`,
    enabled ? "ok" : "info",
  )
}

async function handleRewardUpdate(form) {
  if (state.busy) return
  const rewardId = form.dataset.rewardEditForm
  const data = new FormData(form)
  const cost = Number(data.get("cost"))
  const button = form.querySelector('button[type="submit"]')
  const idleHtml = button ? button.innerHTML : ""

  if (!Number.isInteger(cost) || cost < 1) {
    toast("积分至少 1 颗", "warn")
    return
  }

  state.busy = { action: "update-reward", rewardId }
  if (button) {
    button.disabled = true
    button.innerHTML = "正在保存…"
  }

  const reward = rewardById(rewardId)
  const payload = { rewardId, cost }
  if (reward?.source === "custom") {
    payload.name = String(data.get("name") ?? "")
    payload.description = String(data.get("description") ?? "")
  }

  try {
    await doUpdateReward(payload)
  } catch (error) {
    state.busy = null
    if (button) {
      button.disabled = false
      button.innerHTML = idleHtml
    }
    toast(error?.message || "这次没保存成功", "warn")
    return
  }

  state.busy = null
  closeSheet()
  render({ keepScroll: true })
  toast("已经保存，之后的申请按新价格", "ok")
}

async function handleAddReward(form) {
  if (state.busy) return
  const data = new FormData(form)
  const name = String(data.get("name") ?? "").trim()
  const description = String(data.get("description") ?? "")
  const iconKey = String(data.get("iconKey") ?? "sparkle")
  const cost = Number(data.get("cost"))
  const button = form.querySelector('button[type="submit"]')
  const idleHtml = button ? button.innerHTML : ""

  if (!name) {
    form.querySelector('input[name="name"]')?.focus()
    toast("先给这个奖励起个名字", "warn")
    return
  }
  if (!Number.isInteger(cost) || cost < 1) {
    toast("积分至少 1 颗", "warn")
    return
  }

  state.busy = { action: "add-reward" }
  if (button) {
    button.disabled = true
    button.innerHTML = "正在添加…"
  }

  try {
    await doCreateReward({ name, description, cost, iconKey })
  } catch (error) {
    state.busy = null
    if (button) {
      button.disabled = false
      button.innerHTML = idleHtml
    }
    toast(error?.message || "这次没添加成功", "warn")
    return
  }

  state.busy = null
  render({ keepScroll: true })
  toast(`添加了「${name}」，孩子端立刻能看到`, "ok")
}

/* ---------------- 面板与动作：家长 PIN ---------------- */

function pinSheetHead({ iconName, title, sub, id }) {
  return `
    <div class="sheet__head">
      <span class="task__icon task__icon--lg tone-blue">${icon(iconName, { size: 26 })}</span>
      <div class="sheet__heading">
        <h2 id="${id}">${escapeHtml(title)}</h2>
        <p>${escapeHtml(sub)}</p>
      </div>
      <button class="sheet__close" type="button" data-sheet-close aria-label="关闭">${icon("close", { size: 20 })}</button>
    </div>`
}

function pinInput({ id, name, label }) {
  return `
    <label class="form-label" for="${id}">${escapeHtml(label)}</label>
    <div class="field field--single">
      <input class="input input--pin" id="${id}" name="${name}" type="text" inputmode="numeric"
        autocomplete="off" maxlength="4" placeholder="4 位数字" pattern="\\d{4}" />
    </div>`
}

function openChangePinSheet() {
  openSheet(
    `
    ${pinSheetHead({
      iconName: "lock",
      title: "改一个 PIN",
      sub: "要先输入现在用的 PIN，防止别人顺手改掉",
      id: "change-pin-title",
    })}
    <form class="sheet__form" data-change-pin-form novalidate>
      ${pinInput({ id: "pin-current", name: "currentPin", label: "现在用的 PIN" })}
      ${pinInput({ id: "pin-next", name: "pin", label: "新的 4 位数字" })}
      ${pinInput({ id: "pin-next2", name: "confirm", label: "再输一次新的" })}
      <button class="btn btn--primary btn--xl" type="submit">保存新 PIN</button>
    </form>`,
    { labelledBy: "change-pin-title" },
  )
}

function openClearPinSheet() {
  openSheet(
    `
    ${pinSheetHead({
      iconName: "undo",
      title: "关闭 PIN 保护",
      sub: "关掉之后，孩子点「家长」会直接进管理界面",
      id: "clear-pin-title",
    })}
    <form class="sheet__form" data-clear-pin-form novalidate>
      ${pinInput({ id: "pin-clear", name: "currentPin", label: "现在用的 PIN" })}
      <p class="sheet__hint">数据不会被删除，只是不再要求输入 PIN。以后想开回来随时可以。</p>
      <button class="btn btn--reject btn--block" type="submit">确认关闭</button>
    </form>`,
    { labelledBy: "clear-pin-title" },
  )
}

/** 设置页的「首次设置 PIN」内联表单 */
async function handleSetPinForm(form) {
  if (state.busy) return
  const data = new FormData(form)
  const pin = String(data.get("pin") ?? "").trim()
  const confirm = String(data.get("confirm") ?? "").trim()
  const button = form.querySelector('button[type="submit"]')
  const idleHtml = button ? button.innerHTML : ""

  if (!/^\d{4}$/.test(pin)) {
    toast("PIN 要是 4 位数字", "warn")
    form.querySelector('input[name="pin"]')?.focus()
    return
  }
  if (pin !== confirm) {
    toast("两次输入不一样，再对一下", "warn")
    form.querySelector('input[name="confirm"]')?.focus()
    return
  }

  state.busy = { action: "set-pin" }
  if (button) {
    button.disabled = true
    button.innerHTML = "正在保存…"
  }

  let result
  try {
    result = await doSetParentPin({ pin })
  } catch (error) {
    state.busy = null
    if (button) {
      button.disabled = false
      button.innerHTML = idleHtml
    }
    toast(error?.message || "这次没设置成功", "warn")
    return
  }

  state.busy = null
  render({ keepScroll: true })
  if (result?.recoveryCode) {
    openRecoveryCodeSheet(result.recoveryCode, {
      title: "PIN 已开启，恢复码请存好",
      sub: "忘了 PIN 时凭它重置，只显示这一次",
      onDone: () => toast("PIN 已开启，下次进家长端要输这 4 位数字", "ok"),
    })
  } else {
    toast("PIN 已开启，下次进家长端要输这 4 位数字", "ok")
  }
}

async function handleChangePinForm(form) {
  if (state.busy) return
  const data = new FormData(form)
  const currentPin = String(data.get("currentPin") ?? "").trim()
  const pin = String(data.get("pin") ?? "").trim()
  const confirm = String(data.get("confirm") ?? "").trim()
  const button = form.querySelector('button[type="submit"]')
  const idleHtml = button ? button.innerHTML : ""

  if (!/^\d{4}$/.test(pin)) {
    toast("新 PIN 要是 4 位数字", "warn")
    return
  }
  if (pin !== confirm) {
    toast("两次输入的新 PIN 不一样", "warn")
    return
  }

  state.busy = { action: "change-pin" }
  if (button) {
    button.disabled = true
    button.innerHTML = "正在保存…"
  }

  let result
  try {
    result = await doSetParentPin({ pin, currentPin })
  } catch (error) {
    state.busy = null
    if (button) {
      button.disabled = false
      button.innerHTML = idleHtml
    }
    toast(error?.message || "这次没改成", "warn")
    return
  }

  state.busy = null
  closeSheet()
  render({ keepScroll: true })
  if (result?.recoveryCode) {
    openRecoveryCodeSheet(result.recoveryCode, {
      title: "这台设备还没有恢复码",
      sub: "顺手生成了一串新的，请存好",
    })
  } else {
    toast("PIN 已更新，旧的不能用了", "ok")
  }
}

async function handleClearPinForm(form) {
  if (state.busy) return
  const currentPin = String(new FormData(form).get("currentPin") ?? "").trim()
  const button = form.querySelector('button[type="submit"]')
  const idleHtml = button ? button.innerHTML : ""

  state.busy = { action: "clear-pin" }
  if (button) {
    button.disabled = true
    button.innerHTML = "正在关闭…"
  }

  try {
    await doClearParentPin({ currentPin })
  } catch (error) {
    state.busy = null
    if (button) {
      button.disabled = false
      button.innerHTML = idleHtml
    }
    toast(error?.message || "这次没关掉", "warn")
    return
  }

  state.busy = null
  closeSheet()
  render({ keepScroll: true })
  toast("PIN 保护已关闭", "info")
}

/* ---------------- 面板与动作：恢复码（M4） ---------------- */

/**
 * 展示一次性恢复码。
 * 明文中只在这一刻存在：库里只有加盐摘要，所以"关掉就再也看不到"。
 * 要求勾选"我记下了"才能关，避免家长随手点掉。
 *
 * @param {string} code 形如 `A1B2-C3D4`
 * @param {{ title?: string, sub?: string, onDone?: () => void }} [options]
 */
function openRecoveryCodeSheet(code, { title, sub, onDone } = {}) {
  if (isSheetOpen()) closeSheet()
  openSheet(
    `
    ${pinSheetHead({
      iconName: "key",
      title: title ?? "把这串恢复码存好",
      sub: sub ?? "只显示这一次，关掉就看不到了",
      id: "recovery-title",
    })}
    <div class="recovery-box">
      <p class="recovery-box__label">恢复码</p>
      <p class="recovery-box__code" data-recovery-code>${escapeHtml(code)}</p>
      <button class="mini-btn" type="button" data-copy-recovery>复制</button>
    </div>
    <div class="import-warn import-warn--safe" role="note">
      ${icon("key", { size: 16 })}
      <span>忘了 PIN 时凭这串码重置，<b>数据一条都不会丢</b>。系统里只存摘要，谁也没法把它还原成明文。</span>
    </div>
    <p class="sheet__hint">建议抄在纸上，或拍张照放相册里，别和 PIN 记在同一处。</p>
    <label class="check-row">
      <input type="checkbox" data-recovery-ack />
      <span>我记下了，知道它只出现这一次</span>
    </label>
    <button class="btn btn--primary btn--block" type="button" data-recovery-done disabled>存好了</button>`,
    {
      labelledBy: "recovery-title",
      onMount(panel) {
        const ack = panel.querySelector("[data-recovery-ack]")
        const done = panel.querySelector("[data-recovery-done]")
        const copy = panel.querySelector("[data-copy-recovery]")

        ack?.addEventListener("change", () => {
          if (done) done.disabled = !ack.checked
        })
        copy?.addEventListener("click", async () => {
          const ok = await copyText(code)
          copy.textContent = ok ? "已复制" : "复制失败"
          toast(ok ? "恢复码已复制" : "浏览器不让复制，麻烦手抄一下", ok ? "ok" : "warn")
          window.setTimeout(() => {
            copy.textContent = "复制"
          }, 1800)
        })
        done?.addEventListener("click", () => {
          closeSheet()
          onDone?.()
        })
      },
    },
  )
}

/**
 * 「忘记 PIN」第一步：输入恢复码。
 * @param {string} next 重置成功后要进的家长页
 */
function openForgotPinSheet(next) {
  if (isSheetOpen()) closeSheet()
  openSheet(
    `
    ${pinSheetHead({
      iconName: "key",
      title: "用恢复码重置 PIN",
      sub: "输入当初保存的那串 8 位字符",
      id: "forgot-title",
    })}
    <form class="sheet__form" data-recovery-verify-form data-next-page="${escapeHtml(next)}" novalidate>
      <label class="form-label" for="recovery-code">恢复码</label>
      <div class="field field--single">
        <input class="input input--code" id="recovery-code" name="recoveryCode" type="text"
          autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="9"
          placeholder="A1B2-C3D4" data-recovery-input />
      </div>
      <p class="sheet__hint" data-recovery-msg>横线、空格、大小写都不影响。</p>
      <button class="btn btn--primary btn--xl" type="submit">下一步</button>
    </form>
    <p class="sheet__hint">${icon("info", { size: 14 })}<span>恢复码只在生成时显示过一次，系统里只存摘要，看不到原文。如果它和 PIN 一起丢了，纯本地版本没有后门可以重置 —— 但之前导出的 JSON 备份仍然有效：清空数据后重新导入，任务和星星都会回来。</span></p>
    <button class="btn btn--ghost btn--block" type="button" data-sheet-close>先不进了</button>`,
    {
      labelledBy: "forgot-title",
      onMount(panel) {
        const input = panel.querySelector("[data-recovery-input]")
        input?.addEventListener("input", () => {
          const cleaned = input.value.toUpperCase().replace(/[^A-Z0-9-]/g, "")
          if (cleaned !== input.value) input.value = cleaned
        })
        window.setTimeout(() => input?.focus({ preventScroll: true }), 320)
      },
    },
  )
}

/** 「忘记 PIN」第二步：设新 PIN */
function openResetPinSheet(recoveryCode, next) {
  if (isSheetOpen()) closeSheet()
  openSheet(
    `
    ${pinSheetHead({
      iconName: "lock",
      title: "设一个新的 PIN",
      sub: "恢复码对上了，最后一步",
      id: "reset-pin-title",
    })}
    <form class="sheet__form" data-reset-pin-form data-next-page="${escapeHtml(next)}" novalidate>
      <input type="hidden" name="recoveryCode" value="${escapeHtml(recoveryCode)}" />
      ${pinInput({ id: "pin-reset", name: "pin", label: "新的 4 位数字" })}
      ${pinInput({ id: "pin-reset2", name: "confirm", label: "再输一次新的" })}
      <p class="sheet__hint">旧的 PIN 和旧的恢复码会立刻作废，保存后会给你一串新恢复码。</p>
      <button class="btn btn--primary btn--xl" type="submit">保存新 PIN</button>
    </form>`,
    { labelledBy: "reset-pin-title" },
  )
}

async function handleRecoveryVerify(form) {
  if (state.busy) return
  const raw = String(new FormData(form).get("recoveryCode") ?? "")
  const msg = document.querySelector("[data-recovery-msg]")
  const say = (text, tone = "") => {
    if (!msg) return
    msg.textContent = text
    msg.className = `sheet__hint${tone ? ` is-${tone}` : ""}`
  }

  const cleaned = raw.replace(/[\s-]/g, "")
  if (cleaned.length !== 8) {
    say("恢复码是 8 位字符，形如 A1B2-C3D4", "warn")
    form.querySelector("[data-recovery-input]")?.focus()
    return
  }

  const button = form.querySelector('button[type="submit"]')
  const idleHtml = button ? button.innerHTML : ""
  state.busy = { action: "verify-recovery" }
  if (button) {
    button.disabled = true
    button.innerHTML = "正在核对…"
  }

  let result
  try {
    result = await doVerifyRecoveryCode({ recoveryCode: raw })
  } catch (error) {
    state.busy = null
    if (button) {
      button.disabled = false
      button.innerHTML = idleHtml
    }
    say(error?.message || "核对出错了，再试一次", "warn")
    return
  }

  state.busy = null
  if (button) {
    button.disabled = false
    button.innerHTML = idleHtml
  }

  if (result.ok) {
    openResetPinSheet(raw.toUpperCase(), form.dataset.nextPage ?? "review")
    return
  }  if (result.reason === "locked") {
    say(`试错太多次，等 ${Math.ceil((result.retryAfterMs ?? 0) / 1000)} 秒再试`, "warn")
  } else if (result.reason === "no-recovery") {
    say("这台设备的 PIN 还没有恢复码，进家长端设置页可以补生成", "warn")
  } else if (result.reason === "unset") {
    say("这台设备还没设 PIN，直接点家长 Tab 就能进", "warn")
  } else if (typeof result.remainingAttempts === "number") {
    say(`恢复码不对，还能试 ${result.remainingAttempts} 次`, "warn")
  } else {
    say("恢复码不对，再对一下纸上写的那串", "warn")
  }
}

async function handleResetPinForm(form) {
  if (state.busy) return
  const data = new FormData(form)
  const recoveryCode = String(data.get("recoveryCode") ?? "")
  const pin = String(data.get("pin") ?? "").trim()
  const confirm = String(data.get("confirm") ?? "").trim()
  const button = form.querySelector('button[type="submit"]')
  const idleHtml = button ? button.innerHTML : ""

  if (!/^\d{4}$/.test(pin)) {
    toast("新 PIN 要是 4 位数字", "warn")
    form.querySelector('input[name="pin"]')?.focus()
    return
  }
  if (pin !== confirm) {
    toast("两次输入的新 PIN 不一样", "warn")
    form.querySelector('input[name="confirm"]')?.focus()
    return
  }

  state.busy = { action: "reset-pin" }
  if (button) {
    button.disabled = true
    button.innerHTML = "正在保存…"
  }

  let result
  try {
    result = await doResetPinWithRecovery({ recoveryCode, pin })
  } catch (error) {
    state.busy = null
    if (button) {
      button.disabled = false
      button.innerHTML = idleHtml
    }
    toast(error?.message || "这次没重置成功", "warn")
    return
  }

  state.busy = null
  const next = form.dataset.nextPage ?? "review"
  render()
  openRecoveryCodeSheet(result.recoveryCode, {
    title: "新的恢复码",
    sub: "旧的那串已经作废，这一串要重新存好",
    onDone: () => {
      toast("PIN 已重置，欢迎回来", "ok")
      void goPage(next)
    },
  })
}

/** 设置页「换一个恢复码 / 生成恢复码」 */
async function handleNewRecovery(button) {
  if (state.busy) return
  state.busy = { action: "issue-recovery" }
  if (button) button.disabled = true

  let result
  try {
    result = await doIssueRecoveryCode()
  } catch (error) {
    state.busy = null
    if (button) button.disabled = false
    toast(error?.message || "这次没生成成功", "warn")
    return
  }

  state.busy = null
  render({ keepScroll: true })
  openRecoveryCodeSheet(result.recoveryCode, {
    title: "新的恢复码",
    sub: "旧的那串已经作废，这一串要重新存好",
  })
}

/* ---------------- 面板与动作：彻底删除（M4 / G-05） ---------------- */

function openWipeSheet() {
  if (isSheetOpen()) closeSheet()
  if (state.pinStatus.configured) {
    openWipePinSheet()
    return
  }
  openWipeConfirmSheet()
}

/** 第一步：重验 PIN（需要时） */
function openWipePinSheet() {
  openSheet(
    `
    ${pinSheetHead({
      iconName: "lock",
      title: "删除前再确认一次",
      sub: "输入家长 PIN，防止手机被孩子拿着乱点",
      id: "wipe-pin-title",
    })}
    <form class="sheet__form" data-wipe-pin-form novalidate>
      ${pinInput({ id: "pin-wipe", name: "pin", label: "家长 PIN" })}
      <p class="sheet__hint" data-wipe-pin-msg>这一步只是确认身份，还不会删任何东西。</p>
      <button class="btn btn--primary btn--xl" type="submit">下一步</button>
    </form>
    <button class="btn btn--ghost btn--block" type="button" data-sheet-close>先不删了</button>`,
    { labelledBy: "wipe-pin-title" },
  )
}

/** 第二步：勾选确认，红按钮才亮 */
function openWipeConfirmSheet() {
  const total = state.backup?.total ?? 0
  const children = state.backup?.counts?.children ?? state.children.length
  const tasks = state.backup?.counts?.tasks ?? 0

  openSheet(
    `
    ${pinSheetHead({
      iconName: "trash",
      title: "真的要全部删掉？",
      sub: "没有撤销、没有回收站",
      id: "wipe-title",
    })}
    <div class="import-warn" role="alert">
      ${icon("info", { size: 16 })}
      <span>确认后会<b>立刻清空这台设备上的全部家庭数据</b>，然后回到第一次打开的样子。已导出到电脑或网盘里的 JSON 备份不受影响，随时可以再导入。</span>
    </div>
    <dl class="set-dl set-dl--sheet">
      <div><dt>孩子</dt><dd>${children} 个</dd></div>
      <div><dt>任务</dt><dd>${tasks} 条</dd></div>
      <div><dt>记录总数</dt><dd>${total} 条</dd></div>
    </dl>
    <label class="check-row">
      <input type="checkbox" data-wipe-ack />
      <span>我确认所有孩子数据将被永久抹除</span>
    </label>
    <form class="sheet__form" data-wipe-confirm-form novalidate>
      <button class="btn btn--danger btn--block" type="submit" data-confirm-wipe disabled>
        ${icon("trash", { size: 17 })}永久删除并重置
      </button>
    </form>
    <button class="btn btn--ghost btn--block" type="button" data-sheet-close>先不删了</button>`,
    {
      labelledBy: "wipe-title",
      onMount(panel) {
        const ack = panel.querySelector("[data-wipe-ack]")
        const confirmButton = panel.querySelector("[data-confirm-wipe]")
        ack?.addEventListener("change", () => {
          if (confirmButton) confirmButton.disabled = !ack.checked
        })
      },
    },
  )
}

async function handleWipePinForm(form) {
  if (state.busy) return
  const pin = String(new FormData(form).get("pin") ?? "").trim()
  const msg = form.querySelector("[data-wipe-pin-msg]")
  const say = (text) => {
    if (!msg) return
    msg.textContent = text
    msg.className = "sheet__hint is-warn"
  }

  if (!/^\d{4}$/.test(pin)) {
    say("PIN 是 4 位数字")
    return
  }

  const button = form.querySelector('button[type="submit"]')
  const idleHtml = button ? button.innerHTML : ""
  state.busy = { action: "wipe-pin" }
  if (button) {
    button.disabled = true
    button.innerHTML = "正在核对…"
  }

  let result
  try {
    result = await doRecheckPin({ pin })
  } catch {
    state.busy = null
    if (button) {
      button.disabled = false
      button.innerHTML = idleHtml
    }
    say("核对出错了，再试一次")
    return
  }

  state.busy = null
  if (!result.allowed) {
    if (button) {
      button.disabled = false
      button.innerHTML = idleHtml
    }
    if (result.reason === "locked") {
      say(`输错太多次，等 ${Math.ceil((result.retryAfterMs ?? 0) / 1000)} 秒再试`)
    } else if (typeof result.remainingAttempts === "number") {
      say(`PIN 不对，还能试 ${result.remainingAttempts} 次`)
    } else {
      say("PIN 不对")
    }
    return
  }

  openWipeConfirmSheet()
}

async function handleWipeConfirm(form) {
  if (state.busy) return
  const button = form.querySelector("[data-confirm-wipe]")
  const idleHtml = button ? button.innerHTML : ""
  state.busy = { action: "wipe-all" }
  if (button) {
    button.disabled = true
    button.innerHTML = "正在清空…"
  }

  let result
  try {
    result = await doWipeAllData()
  } catch (error) {
    state.busy = null
    if (button) {
      button.disabled = false
      button.innerHTML = idleHtml
    }
    toast(error?.message || "这次没清空成功，数据没动", "warn")
    return
  }

  state.busy = null
  closeSheet()
  toast(`已清空 ${result.total} 条记录，正在重新初始化…`, "ok")
  // 强制刷新：IndexedDB 里现在是"刚建库"的状态，boot() 会重新种出朵朵
  window.setTimeout(() => window.location.reload(), 700)
}

/* ---------------- 面板与动作：备份 / 恢复 ---------------- */

async function handleExportBackup(button) {
  if (state.busy) return
  state.busy = { action: "export-backup" }
  if (button) button.disabled = true

  let result
  try {
    result = await doExportBackup()
  } catch (error) {
    state.busy = null
    if (button) button.disabled = false
    toast(error?.message || "这次没导出成功", "warn")
    return
  }

  state.busy = null
  const ok = downloadText(result.fileName, result.text)
  render({ keepScroll: true })
  toast(
    ok ? `已导出 ${result.fileName}` : "浏览器没让下载，换个浏览器再试",
    ok ? "ok" : "warn",
  )
}

async function handleImportFileChosen(input) {
  const file = input?.files?.[0]
  // 先清空，保证同一个文件选第二次也能触发 change
  if (input) input.value = ""
  if (!file) return

  let text
  try {
    text = await file.text()
  } catch {
    toast("这个文件读不出来", "warn")
    return
  }

  let summary
  try {
    summary = previewBackup(text)
  } catch (error) {
    toast(error?.message || "这个备份文件不对，已中止", "warn")
    return
  }

  pendingImport = { text, fileName: file.name, summary }
  openImportConfirmSheet(file.name, summary)
}

function openImportConfirmSheet(fileName, summary) {
  const counts = summary.counts
  const rows = [
    ["备份时间", summary.exportedAt ? describeDateTime(summary.exportedAt) : "未标注"],
    ["备份版本", `Schema v${summary.schemaVersion} · 格式 v1`],
    ["记录总数", `${summary.total} 条`],
    ["孩子", `${counts.children ?? 0} 个 · 任务 ${counts.tasks ?? 0} 条 · 流水 ${counts.pointLedger ?? 0} 条`],
  ]

  openSheet(
    `
    ${pinSheetHead({
      iconName: "info",
      title: "用备份覆盖现在的数据？",
      sub: fileName,
      id: "import-title",
    })}
    <div class="import-warn" role="alert">
      ${icon("info", { size: 16 })}
      <span>导入会<b>先清空现在全部数据</b>，再写入备份里的内容。这一步不能靠"返回"撤销，只能靠底部的「撤销上次导入」。请先确认现在的数据已经导出过。</span>
    </div>
    <dl class="set-dl set-dl--sheet">
      ${rows.map(([term, value]) => `<div><dt>${term}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}
    </dl>
    <label class="check-row">
      <input type="checkbox" data-import-ack />
      <span>我明白现在所有数据会被替换</span>
    </label>
    <form class="sheet__form" data-import-confirm-form novalidate>
      <button class="btn btn--reject btn--block" type="submit" data-confirm-import disabled>覆盖并恢复</button>
    </form>
    <button class="btn btn--ghost btn--block" type="button" data-sheet-close>先不导了</button>`,
    {
      labelledBy: "import-title",
      onMount(panel) {
        const ack = panel.querySelector("[data-import-ack]")
        const confirmButton = panel.querySelector("[data-confirm-import]")
        ack?.addEventListener("change", () => {
          if (confirmButton) confirmButton.disabled = !ack.checked
        })
      },
    },
  )
}

async function handleConfirmImport(form) {
  if (state.busy || !pendingImport) return
  const button = form.querySelector("[data-confirm-import]")
  const idleHtml = button ? button.textContent : ""
  if (button) {
    button.disabled = true
    button.textContent = "正在恢复…"
  }
  state.busy = { action: "import-backup" }

  let result
  try {
    result = await doImportBackup(pendingImport.text)
  } catch (error) {
    state.busy = null
    if (button) {
      button.disabled = false
      button.textContent = idleHtml
    }
    toast(error?.message || "导入失败，数据没有改动", "warn")
    return
  }

  state.busy = null
  pendingImport = null
  closeSheet()
  render()
  toast(
    `已恢复 ${result.total} 条记录${result.migrated ? "，并自动补齐到当前版本" : ""}`,
    "ok",
  )
}

async function handleUndoRestore(button) {
  if (state.busy) return
  state.busy = { action: "undo-restore" }
  if (button) button.disabled = true

  let result
  try {
    result = await doUndoRestore()
  } catch (error) {
    state.busy = null
    if (button) button.disabled = false
    toast(error?.message || "没有可以撤销的导入", "warn")
    return
  }

  state.busy = null
  render()
  toast(`已经回到导入前 · ${result.total} 条记录`, "ok")
}

/* ---------------- 动作：固定任务 ---------------- */

/** 只改 DOM：切换「只这一次 / 每天 / 每周几」，不重新渲染，避免丢掉已经填好的表单 */
function handleRepeatSelect(button) {
  const form = button.closest("form")
  if (!form) return
  const value = button.dataset.repeat === "weekly" ? "weekly" : button.dataset.repeat === "daily" ? "daily" : "none"
  const input = form.querySelector("[data-repeat-input]")
  const weekdaysInput = form.querySelector("[data-weekdays-input]")
  const picker = form.querySelector("[data-weekday-picker]")
  const view = form.querySelector("[data-repeat-view]")
  const dueCard = form.querySelector("[data-due-card]")

  if (input) input.value = value
  for (const sibling of button.parentElement.querySelectorAll("[data-repeat]")) {
    const active = sibling === button
    sibling.classList.toggle("is-active", active)
    sibling.setAttribute("aria-selected", String(active))
  }
  if (picker) picker.hidden = value !== "weekly"
  if (dueCard) dueCard.hidden = value !== "none"
  if (view) {
    view.textContent = value === "daily" ? "每天都出现" : value === "weekly" ? "按星期出现" : "只这一次"
  }
  if (value === "none" && weekdaysInput) {
    weekdaysInput.value = ""
    for (const node of form.querySelectorAll("[data-weekday]")) {
      node.setAttribute("aria-pressed", "false")
      node.classList.remove("is-active")
    }
  }
}

function handleWeekdayToggle(button) {
  const pressed = button.getAttribute("aria-pressed") === "true"
  const next = !pressed
  button.setAttribute("aria-pressed", String(next))
  button.classList.toggle("is-active", next)

  const form = button.closest("form")
  const input = form?.querySelector("[data-weekdays-input]")
  if (!input || !form) return
  const values = [...form.querySelectorAll("[data-weekday]")]
    .filter((node) => node.getAttribute("aria-pressed") === "true")
    .map((node) => Number(node.dataset.weekday))
  input.value = values.join(",")
}

async function handleTemplateToggle(button) {
  if (state.busy) return
  const templateId = button.dataset.templateToggle
  const enabled = button.dataset.enabled === "true"

  state.busy = { action: "template-toggle", templateId }
  button.disabled = true

  try {
    await doSetTemplateEnabled({ templateId, enabled })
  } catch (error) {
    state.busy = null
    button.disabled = false
    toast(error?.message || "这次没改成功", "warn")
    return
  }

  state.busy = null
  render({ keepScroll: true })
  toast(enabled ? "已恢复，明天开始又会自动出现" : "已暂停，之后不再自动生成", enabled ? "ok" : "info")
}

function openDeleteTemplateSheet(templateId) {
  const template = state.templates.find((row) => row.id === templateId)
  if (!template) return
  openSheet(
    `
    ${pinSheetHead({
      iconName: "trash",
      title: `删除「${template.title}」？`,
      sub: "之后不再自动生成",
      id: "delete-tpl-title",
    })}
    <p class="sheet__hint">${icon("info", { size: 15 })}<span>已经生成过的任务会留在孩子记录里（那是历史，不删）；只是以后不再自动出现。想暂时不生成可以用「暂停」。</span></p>
    <form class="sheet__form" data-delete-template-form="${escapeHtml(templateId)}" novalidate>
      <button class="btn btn--reject btn--block" type="submit">删除这个固定任务</button>
    </form>
    <button class="btn btn--ghost btn--block" type="button" data-sheet-close>算了</button>`,
    { labelledBy: "delete-tpl-title" },
  )
}

async function handleDeleteTemplateForm(form) {
  if (state.busy) return
  const templateId = form.dataset.deleteTemplateForm
  const button = form.querySelector('button[type="submit"]')
  const idleHtml = button ? button.innerHTML : ""

  state.busy = { action: "delete-template", templateId }
  if (button) {
    button.disabled = true
    button.innerHTML = "正在删除…"
  }

  try {
    await doDeleteTemplate({ templateId })
  } catch (error) {
    state.busy = null
    if (button) {
      button.disabled = false
      button.innerHTML = idleHtml
    }
    toast(error?.message || "这次没删掉", "warn")
    return
  }

  state.busy = null
  closeSheet()
  render({ keepScroll: true })
  toast("固定任务已删除，已有的任务记录保留", "info")
}

/* ---------------- 动作：安装到主屏幕 ---------------- */

/** 浏览器没给 beforeinstallprompt 时，点卡片里的「看安装步骤」给出可操作的指引 */
function openInstallHelpSheet() {
  openSheet(
    `
    ${pinSheetHead({
      iconName: "home",
      title: "把工作台装到桌面",
      sub: "按你现在用的设备选一种做法",
      id: "install-help-title",
    })}
    <div class="install-help">
      <div class="install-help__row">
        <b class="install-help__title">电脑 Chrome / Edge</b>
        <p>点地址栏右侧的「安装」图标（小屏幕带箭头）；没有的话点右上角 ⋮ →「投放、保存和分享」→「安装页面」。</p>
      </div>
      <div class="install-help__row">
        <b class="install-help__title">安卓手机 Chrome</b>
        <p>点右上角 ⋮ →「添加到主屏幕」或「安装应用」，确认后桌面会出现图标。</p>
      </div>
      <div class="install-help__row">
        <b class="install-help__title">iPhone / iPad Safari</b>
        <p>点底部中间的「分享」按钮 → 向下滑找到「添加到主屏幕」→ 右上角「添加」。</p>
      </div>
    </div>
    <p class="set-hint">${icon("info", { size: 14 })}<span>装到桌面只是多了个入口，数据仍留在这台设备的浏览器里。换浏览器、清缓存不会自动带过去，先去「数据备份」导出一份 JSON。</span></p>
    <button class="btn btn--ghost btn--block" type="button" data-sheet-close>知道了</button>`,
    { labelledBy: "install-help-title" },
  )
}

async function handleInstall(button) {
  if (button) button.disabled = true
  const outcome = await promptInstall()
  if (button) button.disabled = false
  if (outcome === "accepted") toast("装好了，主屏幕上能看到工作台", "ok")
  else if (outcome === "dismissed") toast("这次没装，随时可以在设置里再点", "info")
  else toast("这个浏览器现在没给安装入口，可以试试菜单里的「添加到主屏幕」", "warn")
}

/* ---------------- 事件绑定 ---------------- */

function bindEvents() {
  document.addEventListener("click", (event) => {
    const pageButton = event.target.closest("[data-page]")
    if (pageButton) {
      void goPage(pageButton.dataset.page)
      return
    }

    const openChildren = event.target.closest("[data-open-children]")
    if (openChildren) {
      void openChildSwitcher()
      return
    }

    const switchButton = event.target.closest("[data-switch-child]")
    if (switchButton) {
      void handleSwitchChild(switchButton.dataset.switchChild)
      return
    }

    const filterButton = event.target.closest("[data-filter]")
    if (filterButton) {
      state.filter = filterButton.dataset.filter
      render({ keepScroll: true })
      return
    }

    if (event.target.closest("[data-toggle-overdue]")) {
      state.showOverdue = true
      render({ keepScroll: true })
      return
    }

    if (event.target.closest("[data-overdue-collapse]")) {
      state.showOverdue = false
      render({ keepScroll: true })
      return
    }

    const openButton = event.target.closest("[data-open-task]")
    if (openButton) {
      openTaskSheet(openButton.dataset.openTask)
      return
    }

    const approveButton = event.target.closest("[data-approve-task]")
    if (approveButton && !state.busy) {
      void handleApprove(approveButton.dataset.approveTask, approveButton)
      return
    }

    const rejectButton = event.target.closest("[data-reject-task]")
    if (rejectButton && !state.busy) {
      openRejectSheet(rejectButton.dataset.rejectTask)
      return
    }

    const stepButton = event.target.closest("[data-points-step]")
    if (stepButton) {
      const input = document.querySelector("[data-points-input]")
      const view = document.querySelector("[data-points-value]")
      if (input) {
        const next = Math.min(50, Math.max(5, (Number(input.value) || 10) + Number(stepButton.dataset.pointsStep)))
        input.value = String(next)
        if (view) view.textContent = String(next)
      }
      return
    }

    const preset = event.target.closest("[data-preset]")
    if (preset) {
      const input = document.getElementById("assign-title")
      if (input) {
        input.value = preset.dataset.preset ?? ""
        input.focus()
      }
      return
    }

    const dueButton = event.target.closest("[data-due-offset]")
    if (dueButton) {
      const input = document.querySelector("[data-due-input]")
      if (input) input.value = dateKeyOffset(Number(dueButton.dataset.dueOffset) || 0)
      for (const sibling of dueButton.parentElement.querySelectorAll("[data-due-offset]")) {
        sibling.classList.toggle("is-active", sibling === dueButton)
      }
      return
    }

    /* ---------- M2：商城 / 装扮 / 奖励管理 / 兑换审核 ---------- */

    const shopTab = event.target.closest("[data-shop-tab]")
    if (shopTab) {
      state.shopTab = shopTab.dataset.shopTab === "costume" ? "costume" : "life"
      render({ keepScroll: true })
      return
    }

    const rewardTab = event.target.closest("[data-reward-tab]")
    if (rewardTab) {
      state.rewardTab = rewardTab.dataset.rewardTab === "costume" ? "costume" : "life"
      render({ keepScroll: true })
      return
    }

    const requestButton = event.target.closest("[data-request-reward]")
    if (requestButton && !state.busy) {
      void handleRequestRedemption(requestButton)
      return
    }

    const pickButton = event.target.closest("[data-pick-reward]")
    if (pickButton) {
      handlePickReward(pickButton)
      return
    }

    if (event.target.closest("[data-clear-picks]")) {
      void handleClearPicks()
      return
    }

    const submitBatchButton = event.target.closest("[data-submit-batch]")
    if (submitBatchButton && !state.busy) {
      void handleSubmitBatch(submitBatchButton)
      return
    }

    const equipButton = event.target.closest("[data-equip]")
    if (equipButton && !state.busy) {
      void handleEquipCostume(equipButton.dataset.equip, equipButton)
      return
    }

    const unequipButton = event.target.closest("[data-unequip]")
    if (unequipButton && !state.busy) {
      void handleUnequipCostume(unequipButton.dataset.unequip, unequipButton)
      return
    }

    const batchToggle = event.target.closest("[data-batch-toggle]")
    if (batchToggle && !state.busy) {
      toggleBatchItem(batchToggle)
      return
    }

    const acceptBatchButton = event.target.closest("[data-accept-batch]")
    if (acceptBatchButton && !state.busy) {
      void handleAcceptBatch(acceptBatchButton.dataset.acceptBatch, acceptBatchButton)
      return
    }

    const rejectBatchButton = event.target.closest("[data-reject-batch]")
    if (rejectBatchButton && !state.busy) {
      openRejectRedemptionSheet(rejectBatchButton.dataset.rejectBatch)
      return
    }

    const editRewardButton = event.target.closest("[data-edit-reward]")
    if (editRewardButton) {
      openRewardSheet(editRewardButton.dataset.editReward)
      return
    }

    const toggleRewardButton = event.target.closest("[data-toggle-reward]")
    if (toggleRewardButton && !state.busy) {
      void handleToggleReward(toggleRewardButton)
      return
    }

    const costStepButton = event.target.closest("[data-cost-step]")
    if (costStepButton) {
      const input = document.querySelector("[data-cost-input]")
      const view = document.querySelector("[data-cost-value]")
      if (input) {
        const next = Math.min(300, Math.max(1, (Number(input.value) || 30) + Number(costStepButton.dataset.costStep)))
        input.value = String(next)
        if (view) view.textContent = String(next)
      }
      return
    }

    const rewardIconButton = event.target.closest("[data-reward-icon]")
    if (rewardIconButton) {
      const form = rewardIconButton.closest("form")
      const picker = rewardIconButton.closest(".icon-picker")
      const input = form?.querySelector("[data-reward-icon-input]")
      if (input) input.value = rewardIconButton.dataset.rewardIcon
      for (const option of picker?.querySelectorAll("[data-reward-icon]") ?? []) {
        const active = option === rewardIconButton
        option.classList.toggle("is-active", active)
        option.setAttribute("aria-checked", String(active))
      }
      return
    }

    /* ---------- M3：PIN / 备份 / 固定任务 / 安装 ---------- */

    const exitButton = event.target.closest("[data-exit-parent]")
    if (exitButton) {
      exitParentMode()
      return
    }

    if (event.target.closest("[data-change-pin]")) {
      openChangePinSheet()
      return
    }

    if (event.target.closest("[data-clear-pin]")) {
      openClearPinSheet()
      return
    }

    const forgotButton = event.target.closest("[data-forgot-pin]")
    if (forgotButton) {
      openForgotPinSheet(forgotButton.dataset.forgotPin || "review")
      return
    }

    const newRecoveryButton = event.target.closest("[data-new-recovery]")
    if (newRecoveryButton && !state.busy) {
      void handleNewRecovery(newRecoveryButton)
      return
    }

    if (event.target.closest("[data-wipe-data]")) {
      openWipeSheet()
      return
    }

    const exportButton = event.target.closest("[data-export-backup]")
    if (exportButton && !state.busy) {
      void handleExportBackup(exportButton)
      return
    }

    if (event.target.closest("[data-import-backup]")) {
      document.querySelector("[data-import-input]")?.click()
      return
    }

    const undoButton = event.target.closest("[data-undo-restore]")
    if (undoButton && !state.busy) {
      void handleUndoRestore(undoButton)
      return
    }

    const installButton = event.target.closest("[data-install-app]")
    if (installButton) {
      void handleInstall(installButton)
      return
    }

    if (event.target.closest("[data-install-help]")) {
      openInstallHelpSheet()
      return
    }

    const repeatButton = event.target.closest("[data-repeat]")
    if (repeatButton) {
      handleRepeatSelect(repeatButton)
      return
    }

    const weekdayButton = event.target.closest("[data-weekday]")
    if (weekdayButton) {
      handleWeekdayToggle(weekdayButton)
      return
    }

    const templateToggle = event.target.closest("[data-template-toggle]")
    if (templateToggle && !state.busy) {
      void handleTemplateToggle(templateToggle)
      return
    }

    const templateDelete = event.target.closest("[data-template-delete]")
    if (templateDelete) {
      openDeleteTemplateSheet(templateDelete.dataset.templateDelete)
      return
    }

    const avatarButton = event.target.closest("[data-avatar]")
    if (avatarButton) {
      const form = avatarButton.closest("form")
      const picker = avatarButton.closest(".avatar-picker")
      const input = form?.querySelector("[data-avatar-input]")
      if (input) input.value = avatarButton.dataset.avatar
      for (const option of picker?.querySelectorAll("[data-avatar]") ?? []) {
        const active = option === avatarButton
        option.classList.toggle("is-active", active)
        option.setAttribute("aria-checked", String(active))
      }
    }
  })

  document.addEventListener("submit", (event) => {
    const form = event.target
    if (form.matches("[data-submit-task]")) {
      event.preventDefault()
      void handleSubmit(form)
      return
    }
    if (form.matches("[data-reject-form]")) {
      event.preventDefault()
      void handleRejectSubmit(form)
      return
    }
    if (form.matches("[data-assign-form]")) {
      event.preventDefault()
      void handleAssign(form)
      return
    }
    if (form.matches("[data-add-child]")) {
      event.preventDefault()
      void handleAddChild(form)
      return
    }
    if (form.matches("[data-reward-edit-form]")) {
      event.preventDefault()
      void handleRewardUpdate(form)
      return
    }
    if (form.matches("[data-add-reward]")) {
      event.preventDefault()
      void handleAddReward(form)
      return
    }
    if (form.matches("[data-reject-batch-form]")) {
      event.preventDefault()
      void handleRejectBatchSubmit(form)
      return
    }
    if (form.matches("[data-set-pin-form]")) {
      event.preventDefault()
      void handleSetPinForm(form)
      return
    }
    if (form.matches("[data-change-pin-form]")) {
      event.preventDefault()
      void handleChangePinForm(form)
      return
    }
    if (form.matches("[data-clear-pin-form]")) {
      event.preventDefault()
      void handleClearPinForm(form)
      return
    }
    if (form.matches("[data-import-confirm-form]")) {
      event.preventDefault()
      void handleConfirmImport(form)
      return
    }
    if (form.matches("[data-delete-template-form]")) {
      event.preventDefault()
      void handleDeleteTemplateForm(form)
      return
    }
    if (form.matches("[data-recovery-verify-form]")) {
      event.preventDefault()
      void handleRecoveryVerify(form)
      return
    }
    if (form.matches("[data-reset-pin-form]")) {
      event.preventDefault()
      void handleResetPinForm(form)
      return
    }
    if (form.matches("[data-wipe-pin-form]")) {
      event.preventDefault()
      void handleWipePinForm(form)
      return
    }
    if (form.matches("[data-wipe-confirm-form]")) {
      event.preventDefault()
      void handleWipeConfirm(form)
    }
  })

  // 选文件、勾选确认这类只触发 change 的控件，单独委托
  document.addEventListener("change", (event) => {
    if (event.target.matches("[data-import-input]")) {
      void handleImportFileChosen(event.target)
    }
  })
}

/* ---------------- 异常与启动 ---------------- */

function renderFatal(error) {
  const invalid = error?.code === DB_ERROR_CODES.INVALID_STATE
  shell.innerHTML = `
    <main class="fatal">
      <div class="fatal__card" role="alert">
        <span class="fatal__ico">${icon(invalid ? "shield" : "info", { size: 30 })}</span>
        <h1>${invalid ? "本地数据状态异常" : "本地数据暂时打不开"}</h1>
        <p>${
          invalid
            ? "检测到数据还没有完成初始化或恢复。工作台没有覆盖、清空或改写任何原有数据。"
            : "可能是浏览器限制了这个站点的本地存储。工作台不会删除或重建你的数据。"
        }</p>
        <button class="btn btn--primary" type="button" id="fatal-retry">重新打开</button>
      </div>
    </main>`
  shell.querySelector("#fatal-retry")?.addEventListener("click", () => window.location.reload())
}

export async function mountApp(root) {
  if (!root) throw new Error("找不到挂载节点 #app")

  root.innerHTML = `
    <div class="shell" id="shell">
      <header class="topbar" id="topbar"></header>
      <main class="main" id="main"></main>
      <div class="dock" id="dock"></div>
      <nav class="tabbar" id="tabbar" aria-label="主导航"></nav>
    </div>
    <div class="toast-layer" id="toast-layer" aria-live="polite" aria-atomic="true"></div>
    <div class="sheet-layer" id="sheet-layer"></div>
    <div class="burst-layer" id="burst-layer" aria-hidden="true"></div>`

  shell = root.querySelector("#shell")
  topbar = root.querySelector("#topbar")
  main = root.querySelector("#main")
  dock = root.querySelector("#dock")
  tabbar = root.querySelector("#tabbar")

  main.innerHTML = `
    <div class="booting" aria-live="polite">
      <div class="booting__cat">🐱</div>
      <p>正在叫醒团团…</p>
    </div>`

  try {
    await boot()
  } catch (error) {
    renderFatal(error)
    return
  }

  render()
  bindEvents()

  // PWA：浏览器什么时候说"可安装"不确定，配置页要跟着刷新按钮状态
  watchInstallPrompt()
  onInstallChange(() => {
    if (state.booted && state.page === "settings") render({ keepScroll: true })
  })
}
