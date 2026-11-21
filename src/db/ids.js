/**
 * 主键生成
 * 统一带前缀，便于日志与备份文件里辨认记录类型。
 * 优先使用 crypto.randomUUID（浏览器安全上下文 / Node 均有），否则降级。
 */

let fallbackCounter = 0

export function makeId(prefix) {
  const p = typeof prefix === "string" && prefix ? prefix : "id"
  const cryptoApi = globalThis.crypto
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
    return `${p}_${cryptoApi.randomUUID()}`
  }
  fallbackCounter += 1
  const time = Date.now().toString(36)
  const counter = fallbackCounter.toString(36)
  const random = Math.random().toString(36).slice(2, 10)
  return `${p}_${time}-${counter}-${random}`
}
