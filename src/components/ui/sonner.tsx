// Toasts as paper slips (D-47). Follows the app theme (src/lib/theme.ts), not next-themes.
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"
import { useTheme } from "@/lib/theme"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme } = useTheme()
  return (
    <Sonner
      theme={theme}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4 text-success" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4 text-warning" />,
        error: <OctagonXIcon className="size-4 text-destructive" />,
        loading: <Loader2Icon className="size-4 animate-spin motion-reduce:animate-none" />,
      }}
      style={
        {
          "--normal-bg": "var(--paper)",
          "--normal-text": "var(--foreground)",
          "--normal-border": "var(--paper-edge)",
          "--border-radius": "3px",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast !shadow-[var(--overlay-shadow)] font-sans",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
