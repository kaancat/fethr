import * as React from "react"
import * as SliderPrimitive from "@radix-ui/react-slider"
import { cn } from "@/lib/utils"

const GradientSlider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn(
      "relative flex w-full touch-none select-none items-center",
      className
    )}
    {...props}
  >
    <SliderPrimitive.Track className="relative h-2 w-full grow overflow-hidden rounded-full bg-neutral-800 border border-neutral-700">
      <SliderPrimitive.Range className="absolute h-full bg-gradient-to-r from-[#87CEFA] via-[#8A2BE2] to-[#DA70D6]" />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb className="block h-5 w-5 rounded-full bg-gradient-to-r from-[#87CEFA] via-[#8A2BE2] to-[#DA70D6] shadow-lg ring-offset-[#020409] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8A2BE2] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 hover:scale-110" />
  </SliderPrimitive.Root>
))
GradientSlider.displayName = SliderPrimitive.Root.displayName

export { GradientSlider }