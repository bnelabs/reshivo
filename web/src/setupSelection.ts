type SetupIdentity = { id: string; revision: number }

/** Choose the current revision of the selected setup, regardless of list order. */
export function selectedCurrentSetup<T extends SetupIdentity>(setups: readonly T[], selectedId: string): T | undefined {
  return selectedId ? setups.find((setup) => setup.id === selectedId) : setups[0]
}

/** Explain only a change to the selected setup, not an ordinary selection. */
export function setupRevisionNotice(previous: SetupIdentity | null, current: SetupIdentity | undefined): string {
  if (!previous || !current || previous.id !== current.id || previous.revision === current.revision) return ''
  return `Showing version ${current.revision} of this setup.`
}
