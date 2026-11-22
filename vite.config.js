import { readFileSync } from "node:fs"
import { defineConfig } from "vite"

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"))

export default defineConfig({
  // GitHub Pages 子路径部署：产物内所有资源路径都带 /business002-family-workbench/ 前缀
  base: "/business002-family-workbench/",
  // 版本号只有一个来源：package.json。设置页显示它，方便真机确认装的是哪一版
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    port: 5173,
    watch: {
      // 临时验收目录里的下载临时文件（*.crdownload）会被浏览器锁住，
      // fs.watch 对它抛 EBUSY 会直接弄挂 dev server —— 不监视它们
      ignored: ["**/.shots/**", "**/dist/**", "**/node_modules/**"],
    },
  },
  preview: {
    port: 4173,
  },
  build: {
    target: "es2019",
    outDir: "dist",
    assetsDir: "assets",
  },
})
