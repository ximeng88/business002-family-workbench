/**
 * 应用入口
 * 1. 挂载应用外壳
 * 2. 生产环境注册 Service Worker（开发环境不注册，避免缓存干扰热更新）
 */
import "./styles/tokens.css"
import "./styles/base.css"
import "./styles/app.css"
import "./styles/pages.css"
import "./styles/m1.css"
import "./styles/m2.css"
import "./styles/m3.css"
import "./styles/m4.css"
import "./styles/m5.css"
import { mountApp } from "./app/app"

mountApp(document.querySelector("#app"))

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .catch((err) => {
        console.warn("[PWA] Service Worker 注册失败：", err)
      })
  })
}
