import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router'
import { errorMessage } from './api/client'
import { redirectTarget } from './auth/redirect'
import { useCurrentUser } from './auth/useAuth'
import { useProfileLocale } from './auth/useProfileLocale'
import { AppLayout } from './components/AppLayout'
import { Alert, Button, Spinner } from './components/ui'
import { I18nProvider, useT } from './i18n'
import { InvitePage } from './pages/InvitePage'
import { LoginPage } from './pages/LoginPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { NotificationsPage } from './pages/notifications/NotificationsPage'
import { MyTasksPage } from './pages/overview/MyTasksPage'
import { SearchPage } from './pages/overview/SearchPage'
import { BoardPage } from './pages/project/BoardPage'
import { ListPage } from './pages/project/ListPage'
import { MembersPage } from './pages/project/MembersPage'
import { ProjectLayout } from './pages/project/ProjectLayout'
import { SettingsPage } from './pages/project/SettingsPage'
import { TaskNumberRedirect } from './pages/project/TaskNumberRedirect'
import { WikiEditPage, WikiNewPage } from './pages/project/wiki/WikiEditor'
import { WikiHistory } from './pages/project/wiki/WikiHistory'
import { WikiHome } from './pages/project/wiki/WikiHome'
import { WikiLayout } from './pages/project/wiki/WikiLayout'
import { WikiPageView } from './pages/project/wiki/WikiPageView'
import { ProfilePage } from './pages/ProfilePage'
import { ProjectsPage } from './pages/ProjectsPage'
import { RegisterPage } from './pages/RegisterPage'
import { TokensPage } from './pages/TokensPage'

/**
 * Wraps the login and registration pages. Once the user is signed in this is the single place
 * that moves them on, to the page they first asked for.
 */
function GuestOnly({ signedIn }: { signedIn: boolean }) {
  const location = useLocation()
  return signedIn ? <Navigate to={redirectTarget(location.state)} replace /> : <Outlet />
}

/** The whole app; the language is known before anything is drawn. */
export function App() {
  return (
    <I18nProvider>
      <AppRoutes />
    </I18nProvider>
  )
}

function AppRoutes() {
  const currentUser = useCurrentUser()
  const location = useLocation()
  const t = useT()
  useProfileLocale(currentUser.data)

  if (currentUser.isPending) return <Spinner />
  // A failed background refresh keeps the last known user; only a failed first load blocks.
  if (currentUser.data === undefined) {
    return (
      <div className="mx-auto max-w-md space-y-4 p-8">
        <Alert>{errorMessage(currentUser.error)}</Alert>
        <Button onClick={() => void currentUser.refetch()}>{t.shell.app.tryAgain}</Button>
      </div>
    )
  }

  const user = currentUser.data
  const requested = location.pathname + location.search + location.hash
  return (
    <Routes>
      <Route element={<GuestOnly signedIn={user !== null} />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
      </Route>
      <Route
        element={
          user ? (
            <AppLayout user={user} />
          ) : (
            <Navigate to="/login" replace state={{ from: requested }} />
          )
        }
      >
        <Route index element={<ProjectsPage />} />
        <Route path="/tokens" element={<TokensPage />} />
        <Route path="/profile" element={user && <ProfilePage user={user} />} />
        <Route path="/my-tasks" element={<MyTasksPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/invite/:token" element={<InvitePage />} />
        <Route path="/projects/:projectId" element={user && <ProjectLayout currentUser={user} />}>
          <Route index element={<BoardPage />} />
          <Route path="list" element={<ListPage />} />
          <Route path="tasks/:number" element={<TaskNumberRedirect />} />
          <Route path="wiki" element={<WikiLayout />}>
            <Route index element={<WikiHome />} />
            <Route path="new" element={<WikiNewPage />} />
            <Route path=":pageId" element={<WikiPageView />} />
            <Route path=":pageId/edit" element={<WikiEditPage />} />
            <Route path=":pageId/history" element={<WikiHistory />} />
          </Route>
          <Route path="members" element={<MembersPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
