import { useState } from 'react'
import { Link, Outlet, useSearchParams } from 'react-router-dom'
import { AuthGate, AuthOverlay } from 'deepspace'
import { Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

/** Gated pages. AuthGate is UX; the API's JWT check is the security boundary. */
export default function ProtectedLayout() {
  return (
    <AuthGate fallback={<SignedOutPanel />} redirectOnSignOut="/">
      <Outlet />
    </AuthGate>
  )
}

function SignedOutPanel() {
  // The landing page's Sign in links here with ?signin=1 to open the overlay at once.
  const [params] = useSearchParams()
  const [open, setOpen] = useState(params.get('signin') === '1')
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4 py-16">
      <Card className="paper w-full max-w-sm rounded-sm py-8 text-center ring-paper-edge">
        <CardHeader className="justify-items-center">
          <span aria-hidden className="mb-3 grid size-11 place-items-center rounded-full bg-accent text-accent-foreground ring-1 ring-brass/25">
            <Lock className="size-5" />
          </span>
          <CardTitle className="text-xl font-medium tracking-tight"><h1 className="font-display">Sign in to continue</h1></CardTitle>
          <CardDescription>Your cases, worksheets, and provider keys are private to your account.</CardDescription>
        </CardHeader>
        <CardContent className="mt-2 flex flex-col gap-3">
          <Button className="h-9" onClick={() => setOpen(true)}>Sign in</Button>
          <Link to="/sample" className="rounded-sm text-sm text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50">
            Explore the sample instead
          </Link>
        </CardContent>
      </Card>
      {open && <AuthOverlay onClose={() => setOpen(false)} />}
    </div>
  )
}
