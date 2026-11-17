import { useState } from 'react'
import { Link, Outlet } from 'react-router-dom'
import { AuthGate, AuthOverlay } from 'deepspace'
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
  const [open, setOpen] = useState(false)
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4 py-16">
      <Card className="w-full max-w-sm text-center">
        <CardHeader>
          <CardTitle className="text-lg">Sign in to continue</CardTitle>
          <CardDescription>Evaluations, reviews, and API keys are private to your account.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Button onClick={() => setOpen(true)}>Sign in</Button>
          <Link to="/sample" className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
            Explore the sample instead
          </Link>
        </CardContent>
      </Card>
      {open && <AuthOverlay onClose={() => setOpen(false)} />}
    </div>
  )
}
