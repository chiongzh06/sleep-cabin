# Sleep Cabin · 一起睡

**Play: https://yiqishui.onrender.com**

A multiplayer web room where strangers fall asleep together in a snowy log cabin under the aurora.
一间雪山脚下的木屋，和陌生人一起躺下睡觉的多人网页。

- 20 beds, up to 24 people online, a queue when it's full / 20 张床，满员自动排队
- No login, no download / 免下载、免注册
- Short chat (30 chars, 3 s cooldown, no links) / 可聊天（30 字以内、3 秒冷却、不能发链接）
- Set a sleep timer and an optional wake-up alarm; a cat naps on sleepers' bellies / 睡眠时间 + 起床闹钟，猫会趴在睡觉的人肚子上

## Lab pages / 小实验
- `/xiaoren` 线上打小人 · `/tree` 一起养树 · `/offwork` 下班倒计时（全站实时计数，WebSocket `/lab-ws?room=…`）
- 访问量：`/status` 里的 `lab.today.pv`（浏览量）和 `lab.today.uv`（独立访客），按东八区每天统计；数据存在 `data/lab.json`，Render 免费版重新部署后会清零

## Run
```
npm install
npm start   # PORT env var, default 3000
```
- `/` page · `/ws` WebSocket · `/status` stats JSON · `MAX_PLAYERS` env var changes the cap

## Deploy
`render.yaml` is included for a one-click free deploy on Render.

Assets: characters and furniture by KayKit (CC0); the mountain backdrop is procedurally rendered in Blender.
