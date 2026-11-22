/**
 * 家长端「奖励管理」页（M2）。
 *
 * 只调用 reward.service：
 * - 内置奖励：可改积分、可停用，名称与素材由系统维护；
 * - 自定义奖励：可建、可改名改价；
 * - 停用只阻止新申请，不删除记录、不回收已拥有装扮。
 */

import { icon } from "../icons.js"
import { costumeThumb } from "../pet.js"
import { costFieldMarkup } from "../costField.js"
import { REWARD_ICON_KEYS } from "../../services/reward.service.js"
import { state } from "../store.js"
import { escapeHtml } from "../ui.js"

function rewardRow(reward, index) {
  const isCostume = reward.category === "costume"
  const off = reward.enabled === false
  const changed = Number.isInteger(reward.defaultCost) && reward.defaultCost !== reward.cost

  return `
    <li class="reward-row ${off ? "is-off" : ""}" style="--i:${index}" data-reward-row="${escapeHtml(reward.id)}">
      <span class="reward-row__art ${isCostume ? "is-costume" : ""}">
        ${isCostume && reward.costumeKey ? costumeThumb(reward.costumeKey) : icon(reward.iconKey || "sparkle", { size: 24 })}
      </span>

      <div class="reward-row__body">
        <h3>
          ${escapeHtml(reward.name)}
          <span class="reward-row__badge ${reward.source === "builtin" ? "is-builtin" : "is-custom"}">
            ${reward.source === "builtin" ? "内置" : "自定义"}
          </span>
          ${off ? `<span class="reward-row__badge is-off">已停用</span>` : ""}
        </h3>
        <p>${escapeHtml(reward.description || "（没有说明）")}</p>
        <p class="reward-row__price">
          现在 <b>${reward.cost}</b> 颗
          ${
            Number.isInteger(reward.defaultCost)
              ? `<span class="${changed ? "is-changed" : ""}">建议 ${reward.defaultCost} 颗${changed ? "・已改" : ""}</span>`
              : ""
          }
        </p>
      </div>

      <div class="reward-row__ctrl">
        <button class="mini-btn" type="button" data-edit-reward="${escapeHtml(reward.id)}">改积分</button>
        <button class="mini-btn ${off ? "" : "mini-btn--off"}" type="button"
          data-toggle-reward="${escapeHtml(reward.id)}" data-enabled="${off ? "true" : "false"}">
          ${off ? "启用" : "停用"}
        </button>
      </div>
    </li>`
}

function iconPicker() {
  return `
    <div class="icon-picker" role="radiogroup" aria-label="选择图标">
      ${REWARD_ICON_KEYS.slice(0, 8)
        .map(
          (key, index) => `
        <button class="icon-opt ${index === 0 ? "is-active" : ""}" type="button"
          role="radio" aria-checked="${index === 0}" aria-label="${key}" data-reward-icon="${key}">
          ${icon(key, { size: 20 })}
        </button>`,
        )
        .join("")}
    </div>`
}

export function renderRewards() {
  const tab = state.rewardTab === "costume" ? "costume" : "life"
  const all = state.rewards
  const life = all.filter((reward) => reward.category === "life")
  const costume = all.filter((reward) => reward.category === "costume")
  const rows = tab === "costume" ? costume : life
  const offCount = all.filter((reward) => reward.enabled === false).length

  return `
  <section class="page page--rewards" data-page-view="rewards" aria-labelledby="rewards-heading">
    <h1 class="sr-only" id="rewards-heading">奖励管理</h1>

    <div class="parent-hero parent-hero--rewards">
      <div class="parent-hero__text">
        <p class="parent-hero__kicker">家庭设置 · 共 ${all.length} 个奖励</p>
        <h2>奖励由你定价</h2>
        <p class="parent-hero__sub">内置奖励只是建议价，改成你觉得合适的数字（1–10000 任意整数都行，不用凑整）；不想给的时候可以停用，停用不删除历史。</p>
      </div>
      <span class="parent-hero__shield" aria-hidden="true">${icon("starSolid", { size: 30 })}</span>
    </div>

    <div class="parent-stats">
      <div class="parent-stat">
        <strong>${life.length}</strong>
        <span>生活奖励</span>
      </div>
      <div class="parent-stat">
        <strong>${costume.length}</strong>
        <span>宠物装扮</span>
      </div>
      <div class="parent-stat ${offCount ? "parent-stat--hot" : ""}">
        <strong>${offCount}</strong>
        <span>已停用</span>
      </div>
    </div>

    <div class="segmented" role="tablist" aria-label="奖励分类">
      <button class="segmented__btn ${tab === "life" ? "is-active" : ""}" type="button"
        role="tab" aria-selected="${tab === "life"}" data-reward-tab="life">
        生活奖励<span class="segmented__count">${life.length}</span>
      </button>
      <button class="segmented__btn ${tab === "costume" ? "is-active" : ""}" type="button"
        role="tab" aria-selected="${tab === "costume"}" data-reward-tab="costume">
        宠物装扮<span class="segmented__count">${costume.length}</span>
      </button>
    </div>

    <ul class="reward-list">${rows.map(rewardRow).join("")}</ul>

    ${
      tab === "life"
        ? `<form class="add-child add-reward" data-add-reward novalidate>
            <h2>${icon("plus", { size: 18 })}添加一个家里的奖励</h2>
            <p>比如"周末晚睡半小时"。自定义奖励只做生活奖励，积分必须自己填。</p>

            <label class="form-label" for="reward-name">叫什么</label>
            <input class="input" id="reward-name" name="name" maxlength="12"
              placeholder="例如：挑一部电影" autocomplete="off" enterkeyhint="done" />

            <label class="form-label" for="reward-desc">一句话说明（可不填）</label>
            <input class="input" id="reward-desc" name="description" maxlength="20"
              placeholder="例如：全家一起看" autocomplete="off" enterkeyhint="done" />

            <span class="form-label">用哪个图标</span>
            ${iconPicker()}
            <input type="hidden" name="iconKey" value="sparkle" data-reward-icon-input />

            <span class="form-label">要多少星星</span>
            ${costFieldMarkup({ id: "reward-cost", value: 30 })}

            <button class="btn btn--primary btn--xl" type="submit">添加奖励</button>
          </form>`
        : `<p class="page-foot page-foot--parent">${icon("info", { size: 14 })}<span>装扮的名称和样子由系统提供，家长只能调积分和启停；第一版不支持上传图片</span></p>`
    }
  </section>`
}
