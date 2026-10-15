import { errorMessage } from '../../api/client'
import { Markdown } from '../../components/Markdown'
import { Alert, Button, Card, Spinner } from '../../components/ui'
import { intlLocale, useT } from '../../i18n'
import { useDismissedUpdate, useVersionInfo } from './versionQueries'

const linkClass = 'text-indigo-600 hover:underline dark:text-indigo-400'

/** `/about`: the running version, whether a newer one is out, and what changed. */
export function AboutPage() {
  const t = useT()
  const texts = t.shell.about
  const version = useVersionInfo()
  const [dismissed, dismiss] = useDismissedUpdate()

  if (version.isPending) return <Spinner />
  if (version.isError) return <Alert>{errorMessage(version.error)}</Alert>
  const info = version.data
  const checkedAt =
    info.checkedAt &&
    new Date(info.checkedAt).toLocaleString(intlLocale(), {
      dateStyle: 'medium',
      timeStyle: 'short',
    })

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">{texts.title}</h1>
      <Card>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-slate-500">{texts.running}</dt>
          <dd className="font-medium">{info.current}</dd>
          {info.latest && (
            <>
              <dt className="text-slate-500">{texts.latest}</dt>
              <dd className="font-medium">{info.latest}</dd>
            </>
          )}
        </dl>
        <p role="status" className="mt-4 text-sm">
          {!info.checking
            ? texts.checkingOff
            : !info.latest
              ? texts.notChecked
              : info.updateAvailable
                ? texts.updateAvailable(info.latest)
                : texts.upToDate}
          {checkedAt && <span className="text-slate-500"> {texts.checkedAt(checkedAt)}</span>}
        </p>
        {info.updateAvailable && info.latest && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <a
              href={`${info.homepage}#install`}
              target="_blank"
              rel="noreferrer"
              className={linkClass}
            >
              {texts.howToUpdate}
            </a>
            {dismissed !== info.latest && (
              <Button variant="secondary" onClick={() => dismiss(info.latest ?? '')}>
                {texts.dismiss}
              </Button>
            )}
          </div>
        )}
      </Card>

      {info.releases.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">
            {info.updateAvailable ? texts.whatsNew : texts.inThisVersion}
          </h2>
          <p className="text-xs text-slate-500">{texts.englishOnly}</p>
          {info.releases.map((release) => (
            <Card key={release.version}>
              <h3 className="mb-2 text-base font-semibold">{release.version}</h3>
              <Markdown linksLeaveInNewTab>{release.notes}</Markdown>
            </Card>
          ))}
        </section>
      )}

      <p className="text-sm">
        <a href={info.homepage} target="_blank" rel="noreferrer" className={linkClass}>
          {texts.homepage}
        </a>
      </p>
    </div>
  )
}
