/**
 * The app's one navigation surface. On wide screens it is a fixed drawer on
 * the left that folds to a 56 px icon rail (⌘B / Ctrl+B); on narrow screens
 * the same element is a top bar whose menu button opens the drawer over the
 * page. Case files are folders: open one to see its hearings as files, each
 * with a status dot and its status in words.
 *
 * Rhythm: 32 px rows 2 px apart, group labels 24 px above and 8 px below,
 * every icon (and every folder chevron) in one 16 px column. The open page is
 * a paper chip with a 2 px stamp-red mark on its left edge.
 */

import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from 'deepspace'
import { BookOpen, ChevronRight, FileText, Folder, FolderOpen, KeyRound, Library, LogIn, Menu, PanelLeftClose, PanelLeftOpen, Plus, Scale, X, type LucideIcon } from 'lucide-react'
import { BrandMark } from '@/components/BrandMark'
import { NewCaseDialog } from '@/components/evaluations/NewCaseDialog'
import { AccountMenu } from '@/components/shell/AccountMenu'
import { useShellFocusValue } from '@/components/shell/ShellContext'
import { MOD_KEY } from '@/components/shell/use-sidebar-rail'
import { Button } from '@/components/ui/button'
import { Kbd, KbdGroup } from '@/components/ui/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { EvaluationSummary, EvaluationView } from '@/lib/dto'
import { prefetchProps } from '@/lib/prefetch'
import { statusInfo, TONE_DOT } from '@/lib/status'
import { useApi } from '@/lib/use-api'
import { cn } from '@/lib/utils'

const CASE_LIMIT = 8

type SidebarProps = { rail?: boolean; onToggleRail?: () => void }

/** The signed-in-aware sidebar. Needs DeepSpaceAuthProvider above it. */
export function Sidebar(props: SidebarProps) {
  const { isSignedIn } = useAuth()
  return <SidebarView {...props} isSignedIn={!!isSignedIn} account={<AccountMenu compact={props.rail} />} />
}

/**
 * The same sidebar for a browser that has never signed in, on the public
 * pages (sample, glossary). It makes no auth request: F19 promises the sample
 * sends nothing to the server. "Sign in" goes to the protected area, which
 * opens the sign-in dialog.
 */
export function AnonymousSidebar(props: SidebarProps) {
  const account = (
    <Button data-testid="nav-sign-in-button" variant="outline" className={cn('w-full bg-card', props.rail && 'lg:size-9 lg:px-0')} render={<Link to="/evaluations?signin=1" />} nativeButton={false} aria-label={props.rail ? 'Sign in' : undefined}>
      <LogIn aria-hidden />
      <span className={cn(props.rail && 'lg:sr-only')}>Sign in</span>
    </Button>
  )
  return <SidebarView {...props} isSignedIn={false} account={account} />
}

function SidebarView({ rail = false, onToggleRail, isSignedIn, account }: SidebarProps & { isSignedIn: boolean; account: ReactNode }) {
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
    <aside data-testid="app-navigation" data-rail={rail || undefined} aria-label="Primary" className="sticky top-0 z-40 border-b border-drawer-edge bg-drawer print:hidden lg:h-screen lg:border-r lg:border-b-0">
      <div className={cn('flex h-14 items-center justify-between gap-2 px-4 lg:h-16 lg:px-5', rail && 'lg:justify-center lg:px-0')}>
        <Link to={isSignedIn ? '/evaluations' : '/'} className="rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          <BrandMark textClassName={rail ? 'lg:sr-only' : undefined} />
        </Link>
        <Button
          variant="ghost"
          size="icon-lg"
          className="text-muted-foreground hover:bg-accent/70 lg:hidden"
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
        <nav aria-label="Main" className={cn('min-h-0 flex-1 space-y-6 overflow-y-auto px-3 py-2', rail && 'lg:px-2')}>
          <NavGroup rail={rail}>
            <NavItem to="/evaluations" icon={Scale} exact rail={rail}>
              Your cases
            </NavItem>
            {isSignedIn && (
              <NavItem to="/settings/api-keys" icon={KeyRound} rail={rail}>
                Provider keys
              </NavItem>
            )}
          </NavGroup>
          {isSignedIn && <CaseFiles rail={rail} />}
          <NavGroup label="Learn" rail={rail}>
            <NavItem to="/sample" icon={BookOpen} rail={rail}>
              Sample case
            </NavItem>
            <NavItem to="/glossary" icon={Library} rail={rail}>
              Glossary
            </NavItem>
          </NavGroup>
        </nav>
        <nav aria-label="Legal" className={cn('flex flex-wrap gap-x-3 gap-y-1 px-5 pb-2 text-caption text-muted-foreground', rail && 'lg:hidden')}>
          <Link to="/privacy" className="rounded-sm outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
            Privacy
          </Link>
          <Link to="/terms" className="rounded-sm outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
            Terms
          </Link>
          <Link to="/accessibility" className="rounded-sm outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
            Accessibility
          </Link>
        </nav>
        <div className={cn('space-y-1 border-t border-drawer-edge p-3', rail && 'lg:flex lg:flex-col lg:items-center lg:px-2')}>
          {onToggleRail && <RailToggle rail={rail} onToggle={onToggleRail} />}
          {account}
        </div>
      </div>
    </aside>
  )
}

/** Shows `label` beside its trigger, only while the sidebar is a rail. */
function RailTip({ rail, label, children }: { rail: boolean; label: ReactNode; children: ReactElement }) {
  return (
    <Tooltip disabled={!rail}>
      <TooltipTrigger render={children} />
      {rail && <TooltipContent side="right">{label}</TooltipContent>}
    </Tooltip>
  )
}

function Shortcut() {
  return (
    <KbdGroup>
      <Kbd>{MOD_KEY}</Kbd>
      <Kbd>B</Kbd>
    </KbdGroup>
  )
}

function RailToggle({ rail, onToggle }: { rail: boolean; onToggle: () => void }) {
  const Icon = rail ? PanelLeftOpen : PanelLeftClose
  const label = rail ? 'Expand the sidebar' : 'Collapse the sidebar'
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button variant="ghost" className={cn('hidden h-8 w-full justify-start gap-2.5 px-2 font-normal text-muted-foreground hover:bg-accent/70 lg:flex', rail && 'lg:size-8 lg:justify-center lg:px-0')} onClick={onToggle} aria-label={label} aria-keyshortcuts="Meta+B Control+B" />
        }
      >
        <Icon className="size-4" strokeWidth={1.75} aria-hidden />
        <span className={cn('flex-1 text-left text-sm', rail && 'lg:hidden')}>Collapse</span>
        <span className={cn(rail && 'lg:hidden')}>
          <Shortcut />
        </span>
      </TooltipTrigger>
      <TooltipContent side="right">
        {label} <Shortcut />
      </TooltipContent>
    </Tooltip>
  )
}

function NavGroup({ label, action, rail, children }: { label?: string; action?: ReactNode; rail: boolean; children: ReactNode }) {
  return (
    <div>
      {label && (
        <div className={cn('mb-2 flex h-6 items-center justify-between pr-1 pl-2', rail && 'lg:hidden')}>
          <span className="text-xs font-medium text-muted-foreground">{label}</span>
          {action}
        </div>
      )}
      {label && rail && <div aria-hidden className="mx-auto mb-2 hidden h-px w-6 bg-drawer-edge lg:block" />}
      <ul className="space-y-0.5">{children}</ul>
    </div>
  )
}

function rowClass(active: boolean, rail = false) {
  return cn(
    'relative flex h-8 min-w-0 items-center gap-2.5 rounded-md px-2 text-sm outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50',
    active
      ? 'bg-accent font-medium text-accent-foreground'
      : 'text-foreground/80 hover:bg-accent/70 hover:text-foreground',
    rail && 'lg:justify-center lg:px-0',
  )
}

function NavItem({ to, icon: Icon, exact = false, rail, children }: { to: string; icon: LucideIcon; exact?: boolean; rail: boolean; children: string }) {
  const { pathname } = useLocation()
  const active = exact ? pathname === to : pathname === to || pathname.startsWith(`${to}/`)
  return (
    <li>
      <RailTip rail={rail} label={children}>
        <Link to={to} aria-current={active ? 'page' : undefined} className={rowClass(active, rail)} {...prefetchProps(to)}>
          <Icon className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden />
          <span className={cn('truncate', rail && 'lg:sr-only')}>{children}</span>
        </Link>
      </RailTip>
    </li>
  )
}

/** The most recent cases as folders; the case on screen opens automatically. */
function CaseFiles({ rail }: { rail: boolean }) {
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
    <NavGroup
      label="Case files"
      rail={rail}
      action={
        <NewCaseDialog
          trigger={
            <Button variant="ghost" size="icon-xs" className="text-muted-foreground hover:bg-accent/70" aria-label="Open a new case">
              <Plus aria-hidden />
            </Button>
          }
        />
      }
    >
      {rail && (
        <li className="hidden lg:block">
          <NewCaseDialog
            trigger={
              <Button variant="ghost" className="h-8 w-full px-0 text-muted-foreground hover:bg-accent/70" aria-label="Open a new case" title="Open a new case">
                <Plus className="size-4" aria-hidden />
              </Button>
            }
          />
        </li>
      )}
      {list.loading && !list.data && (
        <li className="space-y-1 px-2 py-1" aria-label="Loading case files">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-6 animate-pulse rounded bg-muted motion-reduce:animate-none" />
          ))}
        </li>
      )}
      {list.data && items.length === 0 && <li className={cn('px-2 py-1 text-xs leading-relaxed text-muted-foreground', rail && 'lg:hidden')}>No cases yet. Open one with +.</li>}
      {items.map((item) => (
        <CaseFolder
          key={item.id}
          item={item}
          rail={rail}
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
        <li className={cn(rail && 'lg:hidden')}>
          <Link to="/evaluations" className="flex h-8 items-center rounded-md pr-2 pl-[2.125rem] text-xs text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50">
            All cases
          </Link>
        </li>
      )}
    </NavGroup>
  )
}

const shortTime = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

function CaseFolder({ item, rail, open, current, currentRunId, onToggle }: { item: EvaluationSummary; rail: boolean; open: boolean; current: boolean; currentRunId?: string; onToggle: () => void }) {
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
      {rail && (
        <RailTip rail label={item.title}>
          <Link to={casePath} aria-current={onCase ? 'page' : undefined} className={cn(rowClass(onCase || current, true), 'hidden lg:flex')} aria-label={item.title} {...prefetchProps(casePath)}>
            <FolderIcon className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden />
          </Link>
        </RailTip>
      )}
      <div className={cn(rail && 'lg:hidden')}>
        <div className={rowClass(onCase)}>
          <Button
            variant="ghost"
            onClick={onToggle}
            aria-expanded={open}
            aria-label={`${open ? 'Close' : 'Open'} the ${item.title} folder`}
            className="size-4 shrink-0 rounded-sm p-0 text-muted-foreground hover:bg-transparent hover:text-foreground aria-expanded:bg-transparent"
          >
            <ChevronRight className={cn('size-3.5 motion-safe:transition-transform', open && 'rotate-90')} aria-hidden />
          </Button>
          <Link to={casePath} aria-current={onCase ? 'page' : undefined} className="flex min-w-0 flex-1 items-center gap-2 self-stretch outline-none focus-visible:underline" title={item.title} {...prefetchProps(casePath)}>
            <FolderIcon className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden />
            <span className="truncate">{item.title}</span>
            {item.role === 'reviewer' && <span className="typewriter ml-auto shrink-0 rounded-[3px] bg-sticker px-1 text-caption font-bold text-sticker-foreground">JUROR</span>}
          </Link>
        </div>
        {open && (
          <ul className="mt-0.5 ml-4 space-y-0.5 border-l border-drawer-edge pl-2" aria-label={`Hearings in ${item.title}`}>
            {detail.loading && !detail.data && <li className="h-7 animate-pulse rounded bg-muted motion-reduce:animate-none" aria-label="Loading hearings" />}
            {detail.data && runs.length === 0 && <li className="flex h-7 items-center px-2 text-xs text-muted-foreground">No hearings yet</li>}
            {runs.map((run) => {
              const info = statusInfo(run.status)
              const runPath = `/runs/${run.id}`
              const active = currentRunId === run.id || pathname === runPath || pathname.startsWith(`${runPath}/`)
              return (
                <li key={run.id}>
                  <Link to={runPath} aria-current={active ? 'page' : undefined} className={cn(rowClass(active), 'h-7 gap-2 text-small')} title={`Hearing on ${shortTime.format(run.createdAt)}: ${info.label}`} {...prefetchProps(runPath)}>
                    <FileText className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden />
                    <span className="truncate tabular-nums">{shortTime.format(run.createdAt)}</span>
                    <span className="ml-auto flex shrink-0 items-center gap-1.5 text-caption text-muted-foreground">
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
      </div>
      {!open && status && <span className="sr-only">Latest hearing: {status.label}</span>}
    </li>
  )
}
