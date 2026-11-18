/**
 * Account controls with no DeepSpace SDK import, so the static landing page
 * can use them without loading auth (tests/smoke.spec.ts).
 */

import { Link } from 'react-router-dom'
import { LogIn } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function AccountAvatar({ imageUrl, initial, className }: { imageUrl?: string | null; initial: string; className?: string }) {
  return (
    <Avatar className={cn('size-7 ring-1 ring-paper-edge', className)}>
      {imageUrl && <AvatarImage src={imageUrl} referrerPolicy="no-referrer" alt="" />}
      <AvatarFallback className="bg-primary text-xs font-medium text-primary-foreground">{initial}</AvatarFallback>
    </Avatar>
  )
}

/**
 * The landing page's account control. No session is read there (it is static),
 * so a returning visitor sees their initial and a link into the app; anyone
 * else sees Sign in, which opens the sign-in overlay on arrival.
 */
export function AccountChip({ hint }: { hint: { name: string; initial: string } | null }) {
  if (!hint) {
    return (
      <Button variant="outline" size="sm" render={<Link to="/evaluations?signin=1" />} nativeButton={false}>
        <LogIn aria-hidden /> Sign in
      </Button>
    )
  }
  return (
    <Button variant="ghost" className="h-9 gap-2 pr-3 pl-1" render={<Link to="/evaluations" />} nativeButton={false}>
      <AccountAvatar initial={hint.initial} />
      <span className="text-sm">
        <span className="sr-only">Signed in as {hint.name}. </span>Your cases
      </span>
    </Button>
  )
}
