# 和合本聖經問答競賽 v2

本版沿用 GitHub Pages + Firebase Realtime Database，提供三種模式：

1. **單人競技**：手機、平板、電腦都能直接開 `index.html` 使用，不需要 Firebase 房間或 QR Code。
2. **兩隊競賽**：主持端建立房間並顯示 QR Code；玩家掃碼後輸入名字、選 A隊或 B隊，再用手機四選一作答。答對分數會自動加到個人與隊伍總分。
3. **手機多人**：主持端建立房間並顯示 QR Code；每位玩家各自作答，最後依個人分數排行。

## 遊戲規則
- 每題 30 秒。
- A / B / C / D 四選一。
- 30 秒到後自動公布答案（主持人也可提前公布）。
- 公布答案後不會自動進下一題，必須由主持人按「下一題」。
- 人數不限，不補 AI、不限制奇數或偶數。
- 題目可依全聖經／舊約／新約、66 卷經卷與四種難度篩選。

## 題庫原則
`assets/questions.js` 的正式題庫目前刻意留空。依需求，正確答案必須能由指定的《和合本》經文本身核對，不使用其他網站、解經資料或其他譯本填補。

## GitHub Pages
將所有檔案保持目前結構上傳到 repository 根目錄，再到 Settings → Pages → Deploy from a branch → main → /(root)。

## Firebase
`assets/firebase-config.js` 使用既有 Firebase 專案。`database.rules.json` 目前為測試用途的公開讀寫規則，正式公開使用前建議再加入 Authentication / App Check 或更嚴格的 Rules。


## v4 可直接試玩版
- 已內建 5 題「詩篇／簡單」示範題，可直接測試完整流程。
- 單人競技可用手機、平板、電腦直接玩。
- 兩隊競賽與手機多人可由主畫面產生 QR Code 加入。
- 每題 30 秒；答案公布後必須由主持人按「下一題」。
- 其他經卷／難度尚未匯入正式題庫時，系統會顯示目前可用題數。
