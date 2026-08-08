// vitest 用的 server-only 替身。
// 真正的 server-only 套件在 Next.js bundler 之外被 import 時會直接拋錯，
// 但單元測試就是在 Node 裡直接跑，所以換成這個空模組。
export {}
