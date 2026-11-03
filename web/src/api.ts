export async function api<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    })
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error
    throw new Error('Could not connect. Check your connection and try again; your project is still here.')
  }
  let data: unknown
  try { data = await response.json() } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error
    throw new Error(response.ok
      ? 'The reply could not be read. Please try again; your project is still here.'
      : `The service could not complete this request (${response.status}). Please try again; your project is still here.`)
  }
  if (!response.ok) {
    const failure = data && typeof data === 'object' && 'error' in data ? data.error : null
    const message = failure && typeof failure === 'object' && 'message' in failure ? failure.message : null
    throw new Error(typeof message === 'string' && message.trim()
      ? message : `The service could not complete this request (${response.status}). Please try again; your project is still here.`)
  }
  return data as T
}
