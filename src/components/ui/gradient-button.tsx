import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const gradientButtonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        // Fethr brand gradient - sky blue to purple to magenta
        primary: "bg-gradient-to-r from-[#87CEFA] via-[#8A2BE2] to-[#DA70D6] hover:from-[#75B8E8] hover:via-[#7A25D2] hover:to-[#C85EC4] text-white border-transparent shadow-lg",
        // Subtle brand gradient for secondary actions
        secondary: "bg-gradient-to-r from-[#8A2BE2]/30 to-[#DA70D6]/30 border border-[#8A2BE2]/50 text-white hover:from-[#8A2BE2]/40 hover:to-[#DA70D6]/40 hover:border-[#8A2BE2]/70",
        // Purple-focused gradient
        purple: "bg-gradient-to-r from-[#8A2BE2] to-[#b28dfa] hover:from-[#7A25D2] hover:to-[#a57df5] text-white border-transparent shadow-md",
        // Destructive/red for dangerous actions (stop, delete, etc.)
        destructive: "bg-red-600 hover:bg-red-700 text-white border-red-600"
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  }
)

export interface GradientButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof gradientButtonVariants> {
  asChild?: boolean
}

const GradientButton = React.forwardRef<HTMLButtonElement, GradientButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(gradientButtonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
GradientButton.displayName = "GradientButton"

export { GradientButton, gradientButtonVariants }