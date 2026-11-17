/**
 * The app's one navigation surface. On wide screens it is a fixed drawer on
 * the left; on narrow screens the same element is a top bar whose menu button
 * opens the drawer over the page. Case files are folders: open one to see its
 * hearings as files, each with a status dot and its status in words.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from 'deepspace'
import { BookOpen, ChevronRight, FileText, Folder, FolderOpen, KeyRound, Library, Menu, Scale, X, type LucideIcon } from 'lucide-react'
import { statusInfo, TONE_DOT } from '@/lib/status'
import { AccountMenu } from '@/components/shell/AccountMenu'
import { useShellFocusValue } from '@/components/shell/ShellContext'
import { BrandMark } from '@/components/BrandMark'
import type { EvaluationSummary, EvaluationView } from '@/lib/dto'
import { useApi } from '@/lib/use-api'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const CASE_LIMIT = 8

export function Sidebar() {
  const { isSignedIn } = useAuth()
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => setOpen(false), [location.pathname])
  useEffect(() => {
    if (!open) return
    panelRef.current?.querySelector<HTMLElement>('a, button')?.focus()
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <aside data-testid="app-navigation" aria-label="Primary" className="sticky top-0 z-40 border-b border-drawer-edge bg-drawer print:hidden lg:h-screen lg:border-r lg:border-b-0">
      <div className="flex h-14 items-center justify-between gap-2 px-4 lg:h-16 lg:px-5">
        <Link to={isSignedIn ? '/evaluations' : '/'} className="rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          <BrandMark />
        </Link>
        <Button
          variant="ghost"
          size="icon-lg"
          className="text-muted-foreground hover:bg-paper/70 lg:hidden"
          onClick={() => setOpen((value) => !value)}
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          aria-controls="primary-nav"
        >
          {open ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
        </Button>
      </div>
      {open && <div aria-hidden className="fixed inset-0 top-14 z-30 bg-foreground/20 lg:hidden" onClick={() => setOpen(false)} />}
      <div
        id="primary-nav"
        ref={panelRef}
        className={cn(
          'flex-col bg-drawer lg:flex lg:h-[calc(100vh-4rem)]',
          open ? 'fixed inset-x-0 top-14 bottom-0 z-40 flex max-w-xs border-r border-drawer-edge shadow-xl sm:max-w-sm' : 'hidden',
          'lg:static lg:max-w-none lg:border-0 lg:shadow-none',
        )}
      >
        <nav aria-label="Main" className="min-h-0 flex-1 space-y-6 overflow-y-auto px-3 py-2">
          <NavGroup>
            <NavItem to="/evaluations" icon={Scale} exact>
              Your cases
            </NavItem>
            {isSignedIn && (
              <NavItem to="/settings/api-keys" icon={KeyRound}>
                Provider keys
              </NavItem>
            )}
          </NavGroup>
          {isSignedIn && <CaseFiles />}
          <NavGroup label="Learn">
            <NavItem to="/sample" icon={BookOpen}>
              Sample case
            </NavItem>
            <NavItem to="/glossary" icon={Library}>
              Glossary
            </NavItem>
          </NavGroup>
        </nav>
        <div className="border-t border-drawer-edge p-3">
          <AccountMenu />
        </div>
      </div>
    </aside>
  )
}

function NavGroup({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div>
      {label && <div className="px-2 pb-1.5 text-xs font-medium text-muted-foreground">{label}</div>}
      <ul className="space-y-0.5">{children}</ul>
    </div>
  )
}

function rowClass(active: boolean) {
  return cn(
    'flex h-8 min-w-0 items-center gap-2.5 rounded-md px-2 text-sm outline-none transition-colors duration-150 focus-visible:ring-3 focus-visible:ring-ring/50',
    active ? 'bg-paper font-medium text-foreground shadow-[0_1px_0_var(--paper-edge)] ring-1 ring-paper-edge' : 'text-foreground/80 hover:bg-paper/60 hover:text-foreground',
  )
}

function NavItem({ to, icon: Icon, exact = false, children }: { to: string; icon: LucideIcon; exact?: boolean; children: ReactNode }) {
  const { pathname } = useLocation()
  const active = exact ? pathname === to : pathname === to || pathname.startsWith(`${to}/`)
  return (
    <li>
      <Link to={to} aria-current={active ? 'page' : undefined} className={rowClass(active)}>
        <Icon className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden />
        <span className="truncate">{children}</span>
      </Link>
    </li>
  )
}

/** The most recent cases as folders; the case on screen opens automatically. */
function CaseFiles() {
  const { pathname } = useLocation()
  const focus = useShellFocusValue()
  const list = useApi<{ items: EvaluationSummary[]; nextCursor: string | null }>(`/evaluations?limit=${CASE_LIMIT}`)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const refetched = useRef(new Set<string>())
  const { reload } = list

  // A case just opened (or one older than this page of the list) is not in it yet: refetch once.
  useEffect(() => {
    if (!focus.caseId || !list.data || list.data.items.some((item) => item.id === focus.caseId) || refetched.current.has(focus.caseId)) return
    refetched.current.add(focus.caseId)
    void reload()
  }, [focus.caseId, list.data, reload])
  // Back on the docket after a delete or a new case: refresh the folders.
  useEffect(() => {
    if (pathname === '/evaluations') void reload()
  }, [pathname, reload])
  useEffect(() => {
    if (focus.caseId) setExpanded((current) => (current.has(focus.caseId!) ? current : new Set(current).add(focus.caseId!)))
  }, [focus.caseId])

  const items = list.data?.items ?? []
  return (
    <NavGroup label="Case files">
      {list.loading && !list.data && (
        <li className="space-y-1 px-2 py-1" aria-label="Loading case files">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-6 animate-pulse rounded bg-paper/60 motion-reduce:animate-none" />
          ))}
        </li>
      )}
      {list.data && items.length === 0 && <li className="px-2 py-1 text-xs leading-relaxed text-muted-foreground">No cases yet. Open one from Your cases.</li>}
      {items.map((item) => (
        <CaseFolder
          key={item.id}
          item={item}
          open={expanded.has(item.id)}
          current={focus.caseId === item.id}
          currentRunId={focus.runId}
          onToggle={() =>
            setExpanded((current) => {
              const next = new Set(current)
              if (next.has(item.id)) next.delete(item.id)
              else next.add(item.id)
              return next
            })
          }
        />
      ))}
      {list.data?.nextCursor && (
        <li>
          <Link to="/evaluations" className="block rounded-md px-2 py-1 text-xs text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50">
            All cases
          </Link>
        </li>
      )}
    </NavGroup>
  )
}

const shortTime = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

function CaseFolder({ item, open, current, currentRunId, onToggle }: { item: EvaluationSummary; open: boolean; current: boolean; currentRunId?: string; onToggle: () => void }) {
  const { pathname } = useLocation()
  const detail = useApi<EvaluationView>(open ? `/evaluations/${item.id}` : null)
  const { reload } = detail
  // Starting a hearing or changing its status happens on the pages below; follow them.
  useEffect(() => {
    if (open && current) void reload()
  }, [open, current, pathname, reload])

  const casePath = `/evaluations/${item.id}`
  const onCase = pathname === casePath
  const runs = [...(detail.data?.runs ?? [])].sort((a, b) => b.createdAt - a.createdAt)
  const FolderIcon = open ? FolderOpen : Folder
  const status = item.latestRunStatus ? statusInfo(item.latestRunStatus) : null

  return (
    <li>
      <div className={cn(rowClass(onCase), 'gap-1 pr-1 pl-0.5')}>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onToggle}
          aria-expanded={open}
          aria-label={`${open ? 'Close' : 'Open'} the ${item.title} folder`}
          className="text-muted-foreground hover:bg-transparent aria-expanded:bg-transparent"
        >
          <ChevronRight className={cn('size-3.5 motion-safe:transition-transform motion-safe:duration-150', open && 'rotate-90')} aria-hidden />
        </Button>
        <Link to={casePath} aria-current={onCase ? 'page' : undefined} className="flex min-w-0 flex-1 items-center gap-2 self-stretch outline-none focus-visible:underline" title={item.title}>
          <FolderIcon className={cn('size-4 shrink-0', current ? 'text-manila-foreground' : 'text-muted-foreground')} strokeWidth={1.75} aria-hidden />
          <span className="truncate">{item.title}</span>
          {item.role === 'reviewer' && <span className="typewriter ml-auto shrink-0 rounded-[3px] bg-sticker px-1 text-[0.6875rem] font-bold text-sticker-foreground">JUROR</span>}
        </Link>
      </div>
      {open && (
        <ul className="mt-0.5 ml-[1.125rem] space-y-0.5 border-l border-drawer-edge pl-2" aria-label={`Hearings in ${item.title}`}>
          {detail.loading && !detail.data && <li className="h-6 animate-pulse rounded bg-paper/60 motion-reduce:animate-none" aria-label="Loading hearings" />}
          {detail.data && runs.length === 0 && <li className="px-2 py-1 text-xs text-muted-foreground">No hearings yet</li>}
          {runs.map((run) => {
            const info = statusInfo(run.status)
            const runPath = `/runs/${run.id}`
            const active = currentRunId === run.id || pathname === runPath || pathname.startsWith(`${runPath}/`)
            return (
              <li key={run.id}>
                <Link to={runPath} aria-current={active ? 'page' : undefined} className={cn(rowClass(active), 'h-7 gap-2 text-[0.8125rem]')} title={`Hearing on ${shortTime.format(run.createdAt)}: ${info.label}`}>
                  <FileText className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden />
                  <span className="truncate tabular-nums">{shortTime.format(run.createdAt)}</span>
                  <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[0.6875rem] text-muted-foreground">
                    <span aria-hidden className={cn('size-1.5 rounded-full', TONE_DOT[info.tone])} />
                    <span className="sr-only">{info.label}</span>
                    <span aria-hidden className="hidden xl:inline">{info.label}</span>
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
      {!open && status && <span className="sr-only">Latest hearing: {status.label}</span>}
    </li>
  )
}
