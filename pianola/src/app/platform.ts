// Bridge to the Electron main process (see electron/preload.cjs), with browser fallbacks for development.

export interface PianolaBridge {
  saveText(defaultName: string, content: string): Promise<string | null>
  openText(): Promise<{ name: string; content: string } | null>
  exportBegin(defaultName: string, extension: string): Promise<{ id: number; path: string } | null>
  exportWrite(id: number, position: number, data: Uint8Array): Promise<void>
  exportFinish(id: number): Promise<void>
  exportAbort(id: number): Promise<void>
  reveal(path: string): Promise<void>
  cacheInfo(key: string): Promise<{ exists: boolean; url: string }>
  cacheWrite(key: string, offset: number, data: Uint8Array, last: boolean): Promise<void>
  clipboardRead(): Promise<string>
  clipboardWrite(text: string): Promise<void>
  onMenu(cb: (command: string) => void): void
  platform: string
}

declare global {
  interface Window { pianola?: PianolaBridge }
}

export const bridge: PianolaBridge | undefined = window.pianola
export const isMac = bridge ? bridge.platform === 'darwin' : /Mac/.test(navigator.platform)

export async function saveText(defaultName: string, content: string): Promise<string | null> {
  if (bridge) return bridge.saveText(defaultName, content)
  download(new Blob([content], { type: 'text/javascript' }), defaultName)
  return defaultName
}

export function openText(): Promise<{ name: string; content: string } | null> {
  if (bridge) return bridge.openText()
  return new Promise(resolve => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.pianola,.js,.txt'
    input.onchange = async () => {
      const f = input.files?.[0]
      resolve(f ? { name: f.name, content: await f.text() } : null)
    }
    input.click()
  })
}

export function download(blob: Blob, name: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 10000)
}
