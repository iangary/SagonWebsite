import * as React from 'react'

/**
 * 給 `<form onSubmit>` 用：自己把表單送進 useActionState 的 action，而不是交給 `<form action>`。
 *
 * React 19 的 `<form action={fn}>` 在 action 跑完後（不管回傳成功或欄位錯誤）會自動 reset 表單。
 * 文字欄位還好 —— 頁面 revalidate 後 React 會把新的 defaultValue 寫回 DOM；
 * 但 `<select>` 的 defaultValue 只在掛載時套用一次，reset 之後會跳回「頁面載入時」的選項。
 * 結果是：商品狀態改成「草稿」存檔，下拉選單又顯示「上架中」，再存一次就被改回上架；
 * 欄位驗證失敗時，剛打的內容也會整個被清掉。自己送出就不會 reset，畫面上永遠是剛送出的值。
 *
 *   const [state, formAction, pending] = useActionState(updateThing, INITIAL)
 *   <form onSubmit={submitWithoutReset(formAction)}>
 *
 * 需要「成功後清空表單」的地方（例如新增優惠碼）不要用這個，維持 `<form action>`。
 */
export function submitWithoutReset(action: (formData: FormData) => void) {
  return (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    // 帶上 submitter，按鈕本身的 name/value 才會跟 `<form action>` 一樣出現在 FormData 裡
    const submitter = (event.nativeEvent as SubmitEvent).submitter
    const formData = new FormData(event.currentTarget, submitter)
    React.startTransition(() => action(formData))
  }
}
