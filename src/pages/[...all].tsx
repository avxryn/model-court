import { Link } from 'react-router-dom'
import { BrandMark } from '@/components/BrandMark'
import { buttonVariants } from '@/components/ui/button'
import { APP_NAME } from '../constants'

/** Unknown address: a plain docket slip with a way back to the landing page and the docket. */
export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col bg-background px-4 py-6 sm:px-6">
      <title>{`Not found · ${APP_NAME}`}</title>
      <meta name="robots" content="noindex" />
      <Link to="/" className="self-start rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        <BrandMark />
      </Link>
      <main className="flex flex-1 items-center justify-center">
        <div className="paper w-full max-w-md px-6 py-8 text-center sm:px-8">
          <p className="court-label">Error 404 · No such filing</p>
          <h1 className="mt-3 font-display text-3xl font-medium tracking-tight">This page isn’t on the docket</h1>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">The address may be mistyped, or the case may have been deleted by its judge.</p>
          <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
            <Link to="/" className={buttonVariants()}>
              Back to Model Court
            </Link>
            <Link to="/evaluations" className={buttonVariants({ variant: 'outline' })}>
              Your cases
            </Link>
          </div>
        </div>
      </main>
    </div>
  )
}
