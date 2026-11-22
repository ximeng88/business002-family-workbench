/**
 * 家长端「兑换审核」页（M2 / M5）。
 *
 * 一次孩子提交 = 一个批次（`batchId`），所以这里**按批次出一张卡**：
 * - 卡上列清这批要换的每一件（名称快照 / 当时价格 / 类别），可以逐件勾选；
 * - 「通过」= 勾选的件在一个事务里复核余额、写负向流水、改状态、（装扮）写收藏；
 *   未勾选的件在**同一个事务**里按拒绝处理，不会留下悬挂 pending；
 * - 「先不换这批」= 整批只改状态，不扣分、不发装扮。
 *
 * 余额只在这里作提示；真正校验在服务事务内，界面禁用只是辅助。
 * 老数据（M2 单件、没有 batchId）按"自己一批"处理，展示与操作完全兼容。
 */

import { avatarMarkup } from "../avatar.js"
import { icon } from "../icons.js"
import { costumeThumb } from "../pet.js"
import { rewardById, state } from "../store.js"
import { describeTime, escapeHtml } from "../ui.js"

const CATEGORY_LABEL = { life: "生活奖励", costume: "宠物装扮" }

/** 把扁平的待处理申请按批次分组（没有 batchId 的老数据自成一组） */
export function groupPendingBatches(rows) {
  const groups = []
  const index = new Map()

  for (const row of rows) {
    const key = row.batchId ?? row.id
    let group = index.get(key)
    if (!group) {
      group = {
        batchId: key,
        childId: row.childId,
        child: row.child ?? null,
        balance: row.balance ?? 0,
        requestedAt: row.requestedAt,
        rows: [],
      }
      index.set(key, group)
      groups.push(group)
    }
    group.rows.push(row)
    // 同一批次一定同孩子：余额取最新读到的那个（listRedemptionRequests 已按孩子算过）
    group.balance = row.balance ?? group.balance
    if (String(row.requestedAt ?? "") < String(group.requestedAt ?? "")) group.requestedAt = row.requestedAt
  }

  for (const group of groups) {
    group.rows.sort((a, b) => String(a.requestedAt ?? "").localeCompare(String(b.requestedAt ?? "")))
    group.totalCost = group.rows.reduce((sum, row) => sum + (Number(row.costSnapshot) || 0), 0)
    group.costumeCount = group.rows.filter((row) => row.categorySnapshot === "costume").length
  }

  return groups
}

function batchItemRow(row, index) {
  const isCostume = row.categorySnapshot === "costume"
  const reward = rewardById(row.rewardId)
  const costumeKey = row.costumeKeySnapshot ?? reward?.costumeKey ?? null
  const cost = row.costSnapshot

  return `
    <li class="batch-item" data-batch-row data-redemption-id="${escapeHtml(row.id)}" data-cost="${cost}" style="--i:${index}">
      <button class="batch-item__pick" type="button" data-batch-toggle aria-pressed="true"
        aria-label="这 ${cost} 颗还要不要换">
        <span class="batch-item__box">${icon("check", { size: 12, strokeWidth: 3 })}</span>
      </button>
      <span class="batch-item__art ${isCostume ? "is-costume" : ""}">
        ${isCostume && costumeKey ? costumeThumb(costumeKey) : icon(reward?.iconKey || "sparkle", { size: 20 })}
      </span>
      <span class="batch-item__text">
        <b>${escapeHtml(row.rewardNameSnapshot)}</b>
        <small>${CATEGORY_LABEL[row.categorySnapshot] ?? "奖励"}</small>
      </span>
      <span class="batch-item__cost">${cost} 颗</span>
    </li>`
}

function batchCard(group, index) {
  const child = group.child
  const nickname = child?.nickname ?? "孩子"
  const count = group.rows.length
  const bulk = count > 1
  const shortfall = group.balance < group.totalCost ? group.totalCost - group.balance : 0
  const single = group.rows[0]
  const allIds = group.rows.map((row) => row.id).join(",")

  return `
    <li class="redeem redeem--batch" data-batch-card="${escapeHtml(group.batchId)}" data-batch-ids="${escapeHtml(allIds)}" style="--i:${index}">
      <div class="redeem__head">
        <span class="redeem__art">${avatarMarkup(child, { size: "sm" })}</span>
        <div class="redeem__title">
          <h2>${bulk ? `${escapeHtml(nickname)}想换 ${count} 件` : escapeHtml(single.rewardNameSnapshot)}${
            // 单件不重复列明细，用类别标签补上下面的信息
            bulk
              ? `<span class="redeem__cat">一批</span>`
              : `<span class="redeem__cat">${CATEGORY_LABEL[single.categorySnapshot] ?? "奖励"}</span>`
          }</h2>
          <p>${describeTime(group.requestedAt)} 申请${bulk ? " · 可以只通过其中几件" : ""}</p>
        </div>
        <span class="redeem__cost">${group.totalCost} 颗</span>
      </div>

      ${
        bulk
          ? `<ul class="batch-list">${group.rows.map((row, rowIndex) => batchItemRow(row, rowIndex)).join("")}</ul>`
          : ""
      }

      <div class="redeem__facts">
        ${
          bulk
            ? `<div class="redeem__fact">
                 <span>选中</span>
                 <b data-batch-count>${count} 件</b>
               </div>
               <div class="redeem__fact">
                 <span>合计要扣</span>
                 <b data-batch-total>${group.totalCost} 颗</b>
               </div>`
            : `<div class="redeem__fact">
                 <span>申请时价格</span>
                 <b>${group.totalCost} 颗</b>
               </div>
               <div class="redeem__fact">
                 <span>${escapeHtml(nickname)}现在有</span>
                 <b class="${shortfall ? "is-short" : ""}">${group.balance} 颗</b>
               </div>`
        }
        <div class="redeem__fact">
          <span>${bulk ? `${escapeHtml(nickname)}换完剩` : "换完剩"}</span>
          <b data-batch-left class="${shortfall ? "is-short" : ""}" data-batch-balance="${group.balance}">${
            shortfall ? `还差 ${shortfall} 颗` : `${group.balance - group.totalCost} 颗`
          }</b>
        </div>
      </div>

      <p class="redeem__warn" data-batch-warn ${shortfall ? "" : "hidden"}>
        ${icon("info", { size: 15 })}
        <span data-batch-warn-text>${
          shortfall ? `申请之后星星少了，现在还差 ${shortfall} 颗。让孩子再攒攒，或先不换其中几件。` : ""
        }</span>
      </p>

      <div class="redeem__actions">
        <button class="btn btn--reject" type="button" data-reject-batch="${escapeHtml(group.batchId)}">
          ${icon("undo", { size: 17 })}先不换${bulk ? "这批" : ""}
        </button>
        <button class="btn btn--pass" type="button" data-accept-batch="${escapeHtml(group.batchId)}"
          data-idle-label="${bulk ? `通过 ${count} 件 · 扣 ${group.totalCost} 颗` : `通过并扣 ${group.totalCost} 颗`}"
          ${shortfall ? "disabled" : ""}>
          ${bulk ? `通过 ${count} 件 · 扣 ${group.totalCost} 颗` : `通过并扣 ${group.totalCost} 颗`}
        </button>
      </div>
    </li>`
}

export function renderRedeem() {
  const requests = state.pendingRequests
  const groups = groupPendingBatches(requests)
  const totalCost = requests.reduce((sum, row) => sum + (row.costSnapshot || 0), 0)

  return `
  <section class="page page--redeem" data-page-view="redeem" aria-labelledby="redeem-heading">
    <h1 class="sr-only" id="redeem-heading">兑换审核</h1>

    <div class="parent-hero parent-hero--redeem">
      <div class="parent-hero__text">
        <p class="parent-hero__kicker">星星的去处</p>
        <h2>${
          requests.length
            ? `有 <b>${groups.length}</b> 批兑换等你处理${requests.length > groups.length ? `（共 ${requests.length} 件）` : ""}`
            : "没有待处理的兑换"
        }</h2>
        <p class="parent-hero__sub">${
          requests.length
            ? "孩子现在可以一次选好几件，你点一次就能整批确认；不要的件取消勾选，会一起退回。"
            : "孩子申请兑换后会出现在这里。申请本身不扣星星。"
        }</p>
      </div>
      <span class="parent-hero__shield" aria-hidden="true">${icon("starSolid", { size: 30 })}</span>
    </div>

    ${
      requests.length
        ? `<div class="parent-stats">
            <div class="parent-stat parent-stat--hot">
              <strong>${groups.length}</strong>
              <span>待处理批次</span>
            </div>
            <div class="parent-stat">
              <strong>${totalCost}</strong>
              <span>合计要扣</span>
            </div>
            <div class="parent-stat">
              <strong>${state.rewards.filter((reward) => reward.enabled !== false).length}</strong>
              <span>在架奖励</span>
            </div>
          </div>
          <ul class="redeem-list">${groups.map(batchCard).join("")}</ul>`
        : `<div class="empty empty--parent">
            <div class="empty__art">${icon("check", { size: 32, strokeWidth: 2.6 })}</div>
            <h2>现在没有要处理的兑换</h2>
            <p>孩子想换什么就会来这里等你点头。申请时不扣星星，你确认后才扣。</p>
            <button class="btn btn--ghost" type="button" data-page="rewards">去看看奖励清单</button>
          </div>`
    }

    <div class="redeem-flow">
      <h2>兑换是怎么走的</h2>
      <ol class="redeem-flow__list">
        <li><span>1</span>孩子在商城里勾选一件或几件，一起提交，只是提出申请，星星一颗不动。</li>
        <li><span>2</span>你在这里看到名称和当时的价格；多件会合成一张卡，一次就能处理完。</li>
        <li><span>3</span>通过时先核对星星够不够，够才扣；不够会整批退回，不会出现负分。</li>
        <li><span>4</span>取消勾选的件按「先不换」处理，和通过的那些在同一个事务里落定。</li>
      </ol>
    </div>

    <p class="page-foot page-foot--parent">${icon("info", { size: 14 })}<span>确认 = 余额复核、扣分流水、申请状态、（装扮）收藏，同一个事务；重复点击不会重复扣分</span></p>
  </section>`
}
