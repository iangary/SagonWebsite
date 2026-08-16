import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-[color,background-color,border-color,letter-spacing,opacity] duration-300 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-ink-900 text-cream-50 hover:bg-ink-700',
        outline: 'border border-ink-900 bg-transparent text-ink-900 hover:bg-ink-900 hover:text-cream-50',
        subtle: 'bg-cream-100 text-ink-900 hover:bg-cream-200',
        ghost: 'text-ink-700 hover:bg-cream-100',
        danger: 'bg-sale text-white hover:opacity-90',
        link: 'text-ink-900 underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-9 px-3 text-sm',
        md: 'h-11 px-6 text-sm tracking-wide',
        lg: 'h-13 px-8 text-base tracking-wide',
        icon: 'size-10',
      },
      full: { true: 'w-full', false: '' },
    },
    defaultVariants: { variant: 'primary', size: 'md', full: false },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, full, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp ref={ref} className={cn(buttonVariants({ variant, size, full }), className)} {...props} />
    )
  },
)
Button.displayName = 'Button'

export { buttonVariants }
