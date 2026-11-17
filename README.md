# 質量平衡工作室

穩態、無反應、無循環的成分質量平衡編輯器（開發雛形）。圖面用 React Flow，計算核心是獨立的 `engine.js`。

線上版：https://chaiowei.github.io/mass-balance-studio/（資料只存在各自的瀏覽器；換電腦請用「匯出 JSON／匯入 JSON」帶走專案）。

```bash
npm install
npm run dev      # http://127.0.0.1:4310
npm test         # 計算核心測試
```

操作：從左側把設備拖到圖面（或點一下加入）→ 從右側圓點拖線到另一設備左側圓點 → 在設備上直接填參數 → 右側即時顯示結果。Ctrl+Z 復原、Ctrl+Shift+Z 重做、Delete 刪除；自動存在本機瀏覽器，也可匯出 JSON／CSV。

限制與交接見 `HANDOFF.md`。不是經工程驗證的正式產品。
