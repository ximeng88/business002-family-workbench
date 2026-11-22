/**
 * 奖励积分的输入组件（M6）。
 *
 * 解决的问题：旧版只给「−10 / ＋10」两个按钮、上限 300 且只能 5 或 10 的倍数，
 * 家长只能把「这个奖励值多少」改成「最接近的那一档」，于是所有奖励挤在 10/20/30。
 *
 * 现在的规则：
 * - 可以直接敲任意正整数（1–10000）；
 * - `−1 / ＋1` 与「快选」都只是**快捷键**，不是唯一可选值，点了仍可手改；
 * - 非法输入**不自动纠正**：`13.5` 不会偷偷变 14，`10001` 不会自动截断，
 *   只在输入框下方说清哪里不对，并把保存按钮置灰；
 * - 输入框**故意不设 `maxlength`**：`maxlength="5"` 会把 `100000` 悄悄截成 `10000`，
 *   看着合法、其实被改了值。宁可让 `10001` 明确报错，也不替家长改数字。
 * - 判断逻辑与写库同源（`parseRewardCost`），不会出现"界面放过、写库报错"的割裂。
 *
 * 用法：
 * ```js
 * costFieldMarkup({ id: "reward-edit-cost", value: 30 })
 * // 渲染到 DOM 之后（页面 render 或弹层 onMount）
 * initCostFields(root)
 * ```
 */

import {
  REWARD_COST_MAX,
  REWARD_COST_MIN,
  REWARD_COST_QUICK_PICKS,
  parseRewardCost,
} from "../services/reward.service.js"

/**
 * 积分输入块的 HTML。
 *
 * @param {{ id: string, value: number, name?: string, hint?: string }} options
 */
export function costFieldMarkup({ id, value, name = "cost", hint = "" }) {
  const safeValue = Number.isFinite(Number(value)) ? String(Number(value)) : ""
  return `
    <div class="cost-row">
      <button class="cost-step" type="button" data-cost-step="-1" aria-label="减少 1 颗星星">−</button>
      <div class="cost-field">
        <input class="cost-input" id="${id}" name="${name}" value="${safeValue}"
          inputmode="numeric" autocomplete="off" data-cost-input
          aria-describedby="${id}-hint" />
        <span class="cost-unit">颗</span>
      </div>
      <button class="cost-step" type="button" data-cost-step="1" aria-label="增加 1 颗星星">＋</button>
    </div>

    <div class="cost-quick" role="group" aria-label="常用积分数">
      ${REWARD_COST_QUICK_PICKS.map(
        (pick) => `<button class="cost-chip" type="button" data-cost-set="${pick}">${pick}</button>`,
      ).join("")}
    </div>

    <p class="cost-hint" id="${id}-hint" data-cost-hint>
      ${hint || `${REWARD_COST_MIN}–${REWARD_COST_MAX} 之间的整数。上面的数字只是常用值，点了会填进去，也可以自己敲。`}
    </p>
    <p class="cost-error" data-cost-error hidden></p>`
}

/** 当前输入是否合法（供外部在提交前再确认一次） */
export function readCost(form) {
  const input = form?.querySelector("[data-cost-input]")
  return parseRewardCost(input?.value ?? "")
}

/**
 * 给所有含积分输入的表单挂上交互。可重复调用：已挂过的表单会跳过。
 * @param {ParentNode} [root]
 */
export function initCostFields(root = document) {
  const inputs = root.querySelectorAll("[data-cost-input]")
  for (const input of inputs) {
    const form = input.closest("form")
    if (!form || form.dataset.costBound === "1") continue
    form.dataset.costBound = "1"
    bindForm(form)
  }
}

function bindForm(form) {
  const input = form.querySelector("[data-cost-input]")
  const errorNode = form.querySelector("[data-cost-error]")
  const submit = form.querySelector('button[type="submit"]')
  if (!input) return

  const chips = [...form.querySelectorAll("[data-cost-set]")]

  const paint = () => {
    const parsed = parseRewardCost(input.value)
    if (errorNode) {
      errorNode.hidden = parsed.ok
      errorNode.textContent = parsed.ok ? "" : parsed.message
    }
    input.classList.toggle("is-invalid", !parsed.ok)
    input.setAttribute("aria-invalid", String(!parsed.ok))
    if (submit) submit.disabled = !parsed.ok

    for (const chip of chips) {
      const active = parsed.ok && Number(chip.dataset.costSet) === parsed.value
      chip.classList.toggle("is-on", active)
      chip.setAttribute("aria-pressed", String(active))
    }
    return parsed
  }

  /** 只去掉字母、空格这类明显字符；小数点和负号留着，好让提示说准原因 */
  const sanitize = () => {
    const cleaned = input.value.replace(/[^\d.-]/g, "")
    if (cleaned !== input.value) input.value = cleaned
  }

  form.addEventListener("click", (event) => {
    const stepButton = event.target.closest("[data-cost-step]")
    if (stepButton) {
      const step = Number(stepButton.dataset.costStep) || 0
      const current = Number(input.value)
      const base = Number.isFinite(current) ? current : 0
      const next = Math.min(REWARD_COST_MAX, Math.max(REWARD_COST_MIN, Math.round(base) + step))
      input.value = String(next)
      paint()
      return
    }

    const chip = event.target.closest("[data-cost-set]")
    if (chip) {
      input.value = chip.dataset.costSet ?? ""
      paint()
    }
  })

  input.addEventListener("input", () => {
    sanitize()
    paint()
  })

  input.addEventListener("blur", () => {
    paint()
  })

  paint()
}
