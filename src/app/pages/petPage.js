/**
 * 孩子端「团团与星星」页（M2 / M5）：宠物 / 星星 / 积分商城 / 我的装扮 / 申请记录。
 *
 * 纪律：
 * - 申请兑换只写 pending + 快照，**不扣分**（扣分只发生在家长确认事务里）；
 * - **一次可以选好几件**：勾选只是在内存里攒清单，点「一起告诉爸爸妈妈」才落一个批次；
 * - **合计星星不够就挡在孩子端**：提交按钮直接写「还差 X 颗」，不发申请；
 * - 同一孩子只允许一批 pending：已经在等确认时，商城进入只读态，不允许再攒清单；
 * - 穿戴 / 卸下只改穿戴状态，不写积分或经验；
 * - 等级与经验条仍由累计经验现算，装扮不影响成长。
 */

import { icon } from "../icons.js"
import { catSvg, costumeThumb, hasNightBackground, levelInfo, levelTitle } from "../pet.js"
import { COSTUME_SLOTS, COSTUME_SLOT_LABEL } from "../../services/costume.service.js"
import { isCostumeOwned, pendingRedemptionsOf, state, wornIn } from "../store.js"
import { describeDateKey, describeTime, escapeHtml } from "../ui.js"

const TONES = ["orange", "blue", "green", "purple", "pink"]

const REQUEST_STATUS = {
  pending: { label: "等确认", tone: "wait" },
  accepted: { label: "已换到", tone: "ok" },
  rejected: { label: "没换成", tone: "off" },
}

function ledgerItem(entry, index) {
  const label = describeDateKey(entry.approvalDate) || "更早"
  const negative = entry.delta < 0
  return `
    <li class="ledger__item" style="--i:${index}">
      <span class="ledger__date">${escapeHtml(label)}</span>
      <span class="ledger__reason">${escapeHtml(entry.reason)}</span>
      <span class="ledger__delta ${negative ? "is-minus" : ""}">${negative ? "" : "+"}${entry.delta}</span>
    </li>`
}

/* ---------------- 奖励中心 ---------------- */

/**
 * 当前勾选清单（已过滤下架 / 已拥有 / 已不存在的奖励）。
 * 勾选只存内存，算价只用奖励当前价——真正落库的价格快照在 service 里写。
 */
export function shopSelection() {
  const rows = []
  for (const id of state.shopPicked) {
    const reward = state.rewards.find((row) => row.id === id)
    if (!reward || reward.enabled === false) continue
    if (reward.category === "costume" && reward.costumeKey && isCostumeOwned(reward.costumeKey)) continue
    rows.push(reward)
  }
  const totalCost = rows.reduce((sum, reward) => sum + (Number(reward.cost) || 0), 0)
  const shortage = Math.max(0, totalCost - state.balance)
  return {
    rows,
    ids: rows.map((reward) => reward.id),
    count: rows.length,
    totalCost,
    shortage,
    left: state.balance - totalCost,
  }
}

/** 底部汇总条内容（勾选变化时由 app 层只重画这一块，避免整页动画重放） */
export function shopBarContent() {
  const { count, totalCost, shortage, left } = shopSelection()
  if (!count) return ""
  return `
    <div class="shop-bar__sum">
      <span class="shop-bar__count">已选 <b>${count}</b> 件</span>
      <span class="shop-bar__cost">共 <b>${totalCost}</b> 颗</span>
      <span class="shop-bar__left ${shortage ? "is-short" : ""}">${
        shortage ? `还差 ${shortage} 颗` : `换完还剩 ${left} 颗`
      }</span>
    </div>
    <div class="shop-bar__actions">
      <button class="shop-bar__clear" type="button" data-clear-picks>清空</button>
      <button class="btn btn--primary shop-bar__submit" type="button" data-submit-batch
        data-idle-label="${shortage ? `还差 ${shortage} 颗` : "一起告诉爸爸妈妈"}" ${shortage ? "disabled" : ""}>
        ${shortage ? `还差 ${shortage} 颗` : "一起告诉爸爸妈妈"}
      </button>
    </div>`
}

function shopCard(reward, index, ctx) {
  const isCostume = reward.category === "costume"
  const owned = isCostume && reward.costumeKey ? isCostumeOwned(reward.costumeKey) : false
  const shortfall = state.balance < reward.cost ? reward.cost - state.balance : 0
  const tone = TONES[index % TONES.length]
  const waiting = ctx.pendingRewardIds.has(reward.id)
  const picked = !ctx.hasPending && state.shopPicked.includes(reward.id)

  let action
  if (owned) {
    action = `<span class="shop-card__done">${icon("check", { size: 14, strokeWidth: 2.8 })}已拥有</span>`
  } else if (waiting) {
    action = `<span class="shop-card__wait">等确认</span>`
  } else if (ctx.hasPending) {
    // 已经有一批在等确认：商城只读，不允许再攒清单（服务层同样只允许一批）
    action = `<button class="shop-btn" type="button" disabled>等这批确认</button>`
  } else if (shortfall) {
    // 单件都不够：按钮本身就说清还差多少，点了只提示，不发申请
    action = `<button class="shop-btn shop-btn--short" type="button"
      data-request-reward="${escapeHtml(reward.id)}"
      data-idle-label="还差 ${shortfall} 颗">还差 ${shortfall} 颗</button>`
  } else if (picked) {
    action = `<button class="shop-btn shop-btn--picked" type="button" aria-pressed="true"
      data-pick-reward="${escapeHtml(reward.id)}">${icon("check", { size: 14, strokeWidth: 2.8 })}已选</button>`
  } else {
    action = `<button class="shop-btn shop-btn--pick" type="button" aria-pressed="false"
      data-pick-reward="${escapeHtml(reward.id)}">选这个</button>`
  }

  // 按钮已经写着"还差 X 颗"时不再重复，被状态占位时才在价格旁补一句
  const footShort = shortfall && (owned || waiting || ctx.hasPending)
  const classes = ["shop-card"]
  if (picked) classes.push("is-picked")
  if (shortfall && !owned && !ctx.hasPending) classes.push("is-short")
  if (!owned && !waiting && !ctx.hasPending) classes.push("is-pickable")

  return `
    <li class="${classes.join(" ")}" style="--i:${index}" data-reward-id="${escapeHtml(reward.id)}">
      <span class="shop-card__art tone-${tone}">
        ${isCostume && reward.costumeKey ? costumeThumb(reward.costumeKey) : icon(reward.iconKey || "sparkle", { size: 26 })}
        ${picked ? `<span class="shop-card__check" aria-hidden="true">${icon("check", { size: 11, strokeWidth: 3.2 })}</span>` : ""}
      </span>
      <div class="shop-card__body">
        <h3>${escapeHtml(reward.name)}${
          reward.source === "custom" ? `<span class="shop-card__tag">家里的</span>` : ""
        }</h3>
        <p>${escapeHtml(reward.description || (isCostume ? "换上试试看" : "兑换后告诉家长"))}</p>
        <div class="shop-card__foot">
          <span class="shop-card__cost">${icon("starSolid", { size: 14 })}${reward.cost}</span>
          ${footShort ? `<span class="shop-card__short">还差 ${shortfall} 颗</span>` : ""}
        </div>
      </div>
      <div class="shop-card__action">${action}</div>
    </li>`
}

function pendingBanner() {
  const rows = pendingRedemptionsOf()
  if (!rows.length) return ""
  const names = rows.map((row) => `「${row.rewardNameSnapshot}」`)
  const total = rows.reduce((sum, row) => sum + (Number(row.costSnapshot) || 0), 0)
  const shown = names.slice(0, 3).join("") + (names.length > 3 ? " 等" : "")
  return `
    <div class="shop-pending">
      ${icon("clock", { size: 16 })}
      <span>你申请换 ${shown}${rows.length > 1 ? ` 共 ${rows.length} 件 ${total} 颗` : ""}，等爸爸妈妈确认</span>
    </div>`
}

function rewardCenter() {
  const all = state.rewards
  const enabled = all.filter((reward) => reward.enabled !== false)
  const life = enabled.filter((reward) => reward.category === "life")
  const costume = enabled.filter((reward) => reward.category === "costume")
  const tab = state.shopTab === "costume" ? "costume" : "life"
  const rows = tab === "costume" ? costume : life
  const pendingRows = pendingRedemptionsOf()
  const ctx = {
    hasPending: pendingRows.length > 0,
    pendingRewardIds: new Set(pendingRows.map((row) => row.rewardId)),
  }

  return `
    <div class="shop">
      <div class="shop__head">
        <h2>用星星换点什么</h2>
        <span>${enabled.length} 件可以换</span>
      </div>

      <div class="segmented" role="tablist" aria-label="奖励分类">
        <button class="segmented__btn ${tab === "life" ? "is-active" : ""}" type="button"
          role="tab" aria-selected="${tab === "life"}" data-shop-tab="life">
          ${icon("sparkle", { size: 15 })}生活奖励<span class="segmented__count">${life.length}</span>
        </button>
        <button class="segmented__btn ${tab === "costume" ? "is-active" : ""}" type="button"
          role="tab" aria-selected="${tab === "costume"}" data-shop-tab="costume">
          ${icon("paw", { size: 15 })}宠物装扮<span class="segmented__count">${costume.length}</span>
        </button>
      </div>

      ${
        rows.length
          ? `<ul class="shop-list">${rows.map((reward, index) => shopCard(reward, index, ctx)).join("")}</ul>`
          : `<div class="shop-empty">
              <p>这一类还没有能换的奖励。</p>
              <p class="shop-empty__sub">可以问问爸爸妈妈，让他们加一个。</p>
            </div>`
      }

      <p class="shop__note">${icon("info", { size: 14 })}<span>${
        ctx.hasPending
          ? "这批确认完才能换新的。申请不扣星星，爸爸妈妈确认后才扣。"
          : "可以一次选好几件，爸爸妈妈一次就能确认完。申请不扣，确认后才扣。"
      }</span></p>
    </div>`
}

/* ---------------- 我的装扮 ---------------- */

function wardrobeCell(slot, index) {
  const wornKey = wornIn(slot)
  const ownedEntry = state.costume.bySlot?.[slot]?.[0] ?? null

  if (!ownedEntry) {
    return `
      <div class="wardrobe__cell is-empty" style="--i:${index}">
        <span class="wardrobe__slot">${escapeHtml(COSTUME_SLOT_LABEL[slot])}</span>
        <span class="wardrobe__lock">${icon("plus", { size: 18 })}</span>
        <span class="wardrobe__name">还没有</span>
      </div>`
  }

  const costume = ownedEntry.costume
  const worn = wornKey === costume.costumeKey
  return `
    <button class="wardrobe__cell is-owned ${worn ? "is-worn" : ""}" type="button" style="--i:${index}"
      ${worn ? `data-unequip="${slot}"` : `data-equip="${escapeHtml(costume.costumeKey)}"`}
      aria-pressed="${worn}">
      <span class="wardrobe__slot">${escapeHtml(COSTUME_SLOT_LABEL[slot])}</span>
      ${costumeThumb(costume.costumeKey)}
      <span class="wardrobe__name">${escapeHtml(costume.name)}</span>
      <span class="wardrobe__state">${worn ? "已穿戴" : "穿上看"}</span>
    </button>`
}

function wardrobe() {
  const ownedCount = state.costume.ownedKeys.length
  return `
    <div class="wardrobe">
      <div class="wardrobe__head">
        <h2>我的装扮</h2>
        <span>${ownedCount ? `${ownedCount} 件` : "换到后会出现在这里"}</span>
      </div>
      <div class="wardrobe__grid">
        ${COSTUME_SLOTS.map(wardrobeCell).join("")}
      </div>
    </div>`
}

/* ---------------- 我的申请 ---------------- */

function requestRow(request, index) {
  const status = REQUEST_STATUS[request.status] ?? REQUEST_STATUS.pending
  const when = describeTime(request.requestedAt)
  return `
    <li class="req-row" style="--i:${index}">
      <span class="req-row__name">${escapeHtml(request.rewardNameSnapshot)}</span>
      <span class="req-row__meta">${when} · ${request.costSnapshot} 颗</span>
      <span class="req-row__state req-row__state--${status.tone}">${status.label}</span>
    </li>`
}

function myRequests() {
  const rows = state.redemptions.slice(0, 4)
  if (!rows.length) return ""
  return `
    <div class="req-list">
      <div class="req-list__head">
        <h2>我的兑换</h2>
        <span>共 ${state.redemptions.length} 条</span>
      </div>
      <ul class="req-list__items">${rows.map(requestRow).join("")}</ul>
    </div>`
}

/* ---------------- 页面 ---------------- */

export function renderPetPage() {
  const level = levelInfo(state.petExp)
  const remain = level.need - level.inLevel
  const night = hasNightBackground(state.costume.worn)
  const selection = shopSelection()

  return `
  <section class="page page--pet ${selection.count ? "has-shop-bar" : ""}" data-page-view="pet" aria-labelledby="pet-heading">
    <h1 class="sr-only" id="pet-heading">宠物与积分</h1>

    <div class="pet-stage ${night ? "is-night" : ""}">
      <div class="pet-stage__sky" aria-hidden="true">
        <span class="cloud cloud--a"></span>
        <span class="cloud cloud--b"></span>
        <span class="twinkle twinkle--1">${icon("starSolid", { size: 12 })}</span>
        <span class="twinkle twinkle--2">${icon("starSolid", { size: 9 })}</span>
        <span class="twinkle twinkle--3">${icon("starSolid", { size: 14 })}</span>
      </div>
      <p class="pet-stage__badge">Lv.${level.level}<span>· ${levelTitle(level.level)}</span></p>
      <div class="pet-stage__cat">${catSvg({ worn: state.costume.worn })}</div>
      <h2 class="pet-stage__name">团团</h2>
      <p class="pet-stage__hint">${
        level.inLevel === 0
          ? "多完成一件小事，就能看见它长大"
          : `再攒 ${remain} 点经验就升到 Lv.${level.nextLevel}`
      }</p>
    </div>

    ${pendingBanner()}

    <div class="bank">
      <div class="bank__star">${icon("starSolid", { size: 30 })}</div>
      <div class="bank__text">
        <span>星星存钱罐</span>
        <strong><b data-balance>${state.balance}</b><small>颗</small></strong>
      </div>
      <div class="bank__shine" aria-hidden="true"></div>
    </div>

    <div class="panel">
      <div class="panel__row">
        <span class="panel__label">${icon("sparkle", { size: 15 })}成长经验</span>
        <span class="panel__value">${level.inLevel} / ${level.need}</span>
      </div>
      <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="${level.need}"
        aria-valuenow="${level.inLevel}" aria-label="成长经验">
        <i class="bar__fill" style="--to:${level.percent / 100}"></i>
      </div>
      <p class="panel__foot">任务通过后经验才会增加；装扮只换外观，不影响经验和等级。</p>
    </div>

    <div class="stat-row">
      <div class="stat">
        <strong>${state.todayApproved}</strong>
        <span>今天完成</span>
      </div>
      <div class="stat">
        <strong>${state.todayStars}</strong>
        <span>今天赚的星星</span>
      </div>
      <div class="stat">
        <strong>${state.petExp}</strong>
        <span>累计经验</span>
      </div>
    </div>

    ${rewardCenter()}
    ${wardrobe()}
    ${myRequests()}

    <div class="ledger">
      <div class="ledger__head">
        <h2>最近的星星</h2>
        <span>任务 + · 兑换 −</span>
      </div>
      ${
        state.ledger.length
          ? `<ul class="ledger__list">${state.ledger.map(ledgerItem).join("")}</ul>`
          : `<div class="ledger__empty">
              <p>还没有星星记录。</p>
              <p class="ledger__empty-sub">完成第一件小事，这里就会亮起来。</p>
            </div>`
      }
    </div>

    <p class="page-foot">${icon("info", { size: 14 })}<span>星星由积分流水实时汇总，没有"余额字段"，不会算错</span></p>
  </section>`
}
