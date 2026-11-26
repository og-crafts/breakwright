import info from '../../app.json'
import changelog from '../../changelog.json'
import { version } from '../../package.json'
import { type AppInfo, setApp } from '../../kit/ui/app'
// The page gets no native commands, so it can't open a browser itself.
setApp({ ...info, version, releases: changelog.releases, links: false, channel: (import.meta.env.VITE_CHANNEL as AppInfo['channel'] | undefined) || 'dev' })
