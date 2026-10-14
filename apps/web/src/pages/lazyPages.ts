import { lazy, type ComponentType } from 'react'

/**
 * A page loaded the first time it is opened, so the first screen does not wait for code of
 * pages nobody has visited yet. Pages are named exports; `lazy` wants a default one.
 */
function page<
  Name extends string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- any props; each page keeps its own
  Module extends Record<Name, ComponentType<any>>,
>(load: () => Promise<Module>, name: Name) {
  return lazy(async () => ({ default: (await load())[name] }))
}

export const ForgotPasswordPage = page(() => import('./EmailFlowPages'), 'ForgotPasswordPage')
export const ResetPasswordPage = page(() => import('./EmailFlowPages'), 'ResetPasswordPage')
export const VerifyEmailPage = page(() => import('./EmailFlowPages'), 'VerifyEmailPage')
export const InvitePage = page(() => import('./InvitePage'), 'InvitePage')
export const NotificationsPage = page(
  () => import('./notifications/NotificationsPage'),
  'NotificationsPage',
)
export const MyTasksPage = page(() => import('./overview/MyTasksPage'), 'MyTasksPage')
export const SearchPage = page(() => import('./overview/SearchPage'), 'SearchPage')
export const ProfilePage = page(() => import('./ProfilePage'), 'ProfilePage')
export const TokensPage = page(() => import('./TokensPage'), 'TokensPage')
export const BoardPage = page(() => import('./project/BoardPage'), 'BoardPage')
export const ListPage = page(() => import('./project/ListPage'), 'ListPage')
export const MembersPage = page(() => import('./project/MembersPage'), 'MembersPage')
export const MilestonesPage = page(
  () => import('./project/milestones/MilestonesPage'),
  'MilestonesPage',
)
export const SettingsPage = page(() => import('./project/SettingsPage'), 'SettingsPage')
export const WikiLayout = page(() => import('./project/wiki/WikiLayout'), 'WikiLayout')
export const WikiHome = page(() => import('./project/wiki/WikiHome'), 'WikiHome')
export const WikiPageView = page(() => import('./project/wiki/WikiPageView'), 'WikiPageView')
export const WikiNewPage = page(() => import('./project/wiki/WikiEditor'), 'WikiNewPage')
export const WikiEditPage = page(() => import('./project/wiki/WikiEditor'), 'WikiEditPage')
export const WikiHistory = page(() => import('./project/wiki/WikiHistory'), 'WikiHistory')
