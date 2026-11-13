'use client'

import * as React from 'react'
import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
import { ImagePlus, Save, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Textarea, Select, Field } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { updatePost, uploadPostImages, type PostFormState } from '../actions'
import { PostBodyEditor, submitWithoutReset } from '../post-body-editor'

const INITIAL: PostFormState = { ok: false }

export function PostEditor({
  post,
}: {
  post: {
    id: string
    title: string
    slug: string
    excerpt: string
    bodyHtml: string
    coverImageUrl: string
    tags: string
    status: string
    publishedAt: string
    seoTitle: string
    seoDescription: string
  }
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [state, formAction, pending] = useActionState(updatePost, INITIAL)

  React.useEffect(() => {
    if (state.ok) {
      toast(state.message ?? '已儲存')
      for (const w of state.warnings ?? []) toast(w, 'error')
      // 標題旁的狀態徽章、「在前台檢視」連結是伺服器算的
      router.refresh()
    }
    if (state.error) toast(state.error, 'error')
  }, [state, toast, router])

  const errors = state.fieldErrors ?? {}

  return (
    <form onSubmit={submitWithoutReset(formAction)} className="space-y-6">
      <input type="hidden" name="id" value={post.id} />

      <section className="border border-cream-200 bg-white p-5">
        <h2 className="mb-5 text-sm tracking-[0.1em]">基本資料</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="標題" htmlFor="title" required error={errors.title}>
              <Input id="title" name="title" defaultValue={post.title} maxLength={200} required />
            </Field>
          </div>

          <div className="sm:col-span-2">
            <Field
              label="網址代稱"
              htmlFor="slug"
              required
              error={errors.slug}
              hint="文章網址是 /journal/網址代稱。發布後再改，分享出去的舊連結就會失效。"
            >
              <Input id="slug" name="slug" defaultValue={post.slug} maxLength={120} required />
            </Field>
          </div>

          <Field label="狀態" htmlFor="status" required>
            <Select id="status" name="status" defaultValue={post.status}>
              <option value="DRAFT">草稿（前台看不到）</option>
              <option value="PUBLISHED">發布</option>
            </Select>
          </Field>

          <Field
            label="發布時間（台北時間）"
            htmlFor="publishedAt"
            error={errors.publishedAt}
            hint="發布時留白 = 現在。填未來的時間就是排程，時間到了才會出現在前台。"
          >
            <Input id="publishedAt" name="publishedAt" type="datetime-local" defaultValue={post.publishedAt} />
          </Field>

          <div className="sm:col-span-2">
            <Field label="標籤" htmlFor="tags" hint="用逗號或頓號分隔，例如：穿搭、新品、睡衣保養。最多 10 個。">
              <Input id="tags" name="tags" defaultValue={post.tags} />
            </Field>
          </div>

          <div className="sm:col-span-2">
            <Field
              label="摘要"
              htmlFor="excerpt"
              error={errors.excerpt}
              hint="顯示在文章列表與分享預覽。留白會自動取內文開頭約 120 字。"
            >
              <Textarea id="excerpt" name="excerpt" defaultValue={post.excerpt} maxLength={500} />
            </Field>
          </div>
        </div>
      </section>

      <CoverImage postId={post.id} defaultValue={post.coverImageUrl} error={errors.coverImageUrl} />

      <section className="border border-cream-200 bg-white p-5">
        <h2 className="mb-5 text-sm tracking-[0.1em]">內文</h2>
        <PostBodyEditor id="bodyHtml" name="bodyHtml" defaultValue={post.bodyHtml} postId={post.id} error={errors.bodyHtml} />
        {errors.bodyHtml && <p className="mt-1 text-xs text-sale">{errors.bodyHtml}</p>}
      </section>

      <section className="border border-cream-200 bg-white p-5">
        <h2 className="mb-2 text-sm tracking-[0.1em]">搜尋引擎（選填）</h2>
        <p className="mb-5 text-xs text-taupe-500">留白就用標題與摘要。</p>
        <div className="grid gap-4">
          <Field label="SEO 標題" htmlFor="seoTitle">
            <Input id="seoTitle" name="seoTitle" defaultValue={post.seoTitle} maxLength={200} />
          </Field>
          <Field label="SEO 描述" htmlFor="seoDescription" hint="建議 80～150 字">
            <Textarea id="seoDescription" name="seoDescription" defaultValue={post.seoDescription} maxLength={300} />
          </Field>
        </div>
      </section>

      <div className="sticky bottom-0 z-10 -mx-1 flex justify-end border-t border-cream-200 bg-cream-50/95 px-1 py-3 backdrop-blur">
        <Button type="submit" disabled={pending}>
          <Save size={15} />
          {pending ? '儲存中…' : '儲存文章'}
        </Button>
      </div>
    </form>
  )
}

/** 封面圖：上傳後先放進表單的隱藏欄位，按「儲存文章」才寫入。 */
function CoverImage({ postId, defaultValue, error }: { postId: string; defaultValue: string; error?: string }) {
  const { toast } = useToast()
  const fileRef = React.useRef<HTMLInputElement>(null)
  const [url, setUrl] = React.useState(defaultValue)
  const [uploading, setUploading] = React.useState(false)

  async function upload(file: File) {
    const form = new FormData()
    form.set('postId', postId)
    form.append('images', file)
    setUploading(true)
    const result = await uploadPostImages(form)
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
    if (!result.ok || !result.images?.[0]) {
      toast(result.failures?.[0]?.reason ?? result.error ?? '上傳失敗', 'error')
      return
    }
    setUrl(result.images[0].url)
    toast('封面已上傳，記得按「儲存文章」')
  }

  return (
    <section className="border border-cream-200 bg-white p-5">
      <h2 className="mb-2 text-sm tracking-[0.1em]">封面圖片</h2>
      <p className="mb-4 text-xs text-taupe-500">
        列表卡片、文章頂端與分享到 LINE / Facebook 的預覽圖。建議橫式 1600×900 左右。
      </p>
      <input type="hidden" name="coverImageUrl" value={url} />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <div className="flex aspect-[16/9] w-full max-w-sm items-center justify-center overflow-hidden border border-cream-200 bg-cream-100">
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element -- 後台預覽
            <img src={url} alt="封面預覽" className="size-full object-cover" />
          ) : (
            <span className="text-xs text-taupe-500">尚未設定封面</span>
          )}
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
            <ImagePlus size={14} />
            {uploading ? '上傳中…' : url ? '更換封面' : '上傳封面'}
          </Button>
          {url && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setUrl('')}>
              <Trash2 size={14} />
              移除
            </Button>
          )}
        </div>
      </div>
      {error && <p className="mt-2 text-xs text-sale">{error}</p>}

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif"
        hidden
        onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
      />
    </section>
  )
}
