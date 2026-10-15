import { versionInfoSchema, type VersionInfo } from '@chilladesk/shared'
import { apiRequest } from './client'

export const fetchVersionInfo = (): Promise<VersionInfo> =>
  apiRequest('/version', { schema: versionInfoSchema })
