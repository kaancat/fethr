import * as React from "react"
import { cn } from "@/lib/utils"

interface DropdownMenuProps {
  children: React.ReactNode
  className?: string
  style?: React.CSSProperties
}

export const DropdownMenu = React.forwardRef<
  HTMLDivElement,
  DropdownMenuProps
>(({ className, children, style, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "absolute z-50 min-w-[180px] overflow-hidden rounded-lg border border-neutral-800/50 bg-[#0A0F1A]/95 backdrop-blur-md p-1.5 text-neutral-100 shadow-2xl animate-in fade-in-0 zoom-in-95",
      "shadow-[0_0_20px_rgba(166,246,255,0.15)]" ,
      className
    )}
    style={style}
    {...props}
  >
    {children}
  </div>
))
DropdownMenu.displayName = "DropdownMenu"

interface DropdownMenuItemProps {
  children: React.ReactNode
  className?: string
  onClick?: () => void
  disabled?: boolean
}

export const DropdownMenuItem = React.forwardRef<
  HTMLDivElement,
  DropdownMenuItemProps
>(({ className, children, onClick, disabled, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "relative flex cursor-pointer select-none items-center rounded-md px-3 py-2 text-sm outline-none transition-all duration-150",
      disabled
        ? "pointer-events-none opacity-40"
        : "hover:bg-[#A6F6FF]/10 hover:text-[#A6F6FF] hover:shadow-[0_0_10px_rgba(166,246,255,0.1)]",
      "text-neutral-300",
      className
    )}
    onClick={disabled ? undefined : onClick}
    {...props}
  >
    {children}
  </div>
))
DropdownMenuItem.displayName = "DropdownMenuItem"

export const DropdownMenuSeparator = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("-mx-1 my-1.5 h-px bg-neutral-800/50", className)}
    {...props}
  />
))
DropdownMenuSeparator.displayName = "DropdownMenuSeparator"