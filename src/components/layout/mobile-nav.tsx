'use client'

import * as React from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Menu, X } from 'lucide-react'
import { Link } from '@/i18n/routing'

export function MobileNav({
  links,
  labels,
}: {
  links: { href: string; label: string }[]
  labels: { menu: string; open: string; close: string }
}) {
  const [open, setOpen] = React.useState(false)

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger
        aria-label={labels.open}
        className="-ml-2 flex size-10 items-center justify-center text-ink-700 lg:hidden"
      >
        <Menu size={20} strokeWidth={1.5} />
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-70 bg-ink-900/30 backdrop-blur-sm" />
        <Dialog.Content className="fixed inset-y-0 left-0 z-80 flex w-[85vw] max-w-xs flex-col bg-cream-50 shadow-xl">
          <div className="flex h-16 items-center justify-between border-b border-cream-200 px-5">
            <Dialog.Title className="font-serif-display text-lg tracking-widest">
              {labels.menu}
            </Dialog.Title>
            <Dialog.Close aria-label={labels.close} className="text-taupe-500 hover:text-ink-900">
              <X size={20} />
            </Dialog.Close>
          </div>
          <nav className="flex-1 overflow-y-auto py-2">
            <ul>
              {links.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    onClick={() => setOpen(false)}
                    className="block border-b border-cream-100 px-5 py-3.5 text-sm text-ink-700 transition-colors hover:bg-cream-100"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
