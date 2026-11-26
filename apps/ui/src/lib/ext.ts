import { LOADER_INFO, extensionKind, type ServerView } from '@trm/core'

/** Unterstützt dieser Server Mods oder Plugins? */
export const supportsMods = (s: ServerView) => !!LOADER_INFO[s.loader].extFolder && !!extensionKind(s.loader)
