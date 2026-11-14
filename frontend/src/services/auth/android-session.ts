export interface AndroidSessionStorage {
  read(): Promise<string>
  write(value: string): Promise<void>
  clear(): Promise<void>
}

export async function saveAndroidSession(storage: AndroidSessionStorage, server: string, token: string): Promise<void> {
  await storage.write(JSON.stringify({ server, token }))
}

export async function loadAndroidSession(storage: AndroidSessionStorage, server: string): Promise<string> {
  try {
    const saved = JSON.parse(await storage.read()) as { server?: unknown; token?: unknown }
    return saved?.server === server && typeof saved.token === 'string' ? saved.token : ''
  } catch {
    return ''
  }
}

export function shouldClearSession(error: unknown): boolean {
  return (error as { response?: { status?: number } })?.response?.status === 401
}
