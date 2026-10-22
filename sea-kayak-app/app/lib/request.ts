export async function requestJson(url: string, { signal, timeoutMs = 8000, maxBytes = 16 * 1024 * 1024 }: { signal?: AbortSignal, timeoutMs?: number, maxBytes?: number } = {}): Promise<unknown> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error("Invalid download limits")
  if (signal?.aborted) throw new DOMException("Cancelled", "AbortError")
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let abort: (() => void) | undefined
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    return await Promise.race([
      new Promise<never>((_, reject) => {
        abort = () => { controller.abort(); reject(new DOMException("Cancelled", "AbortError")) }
        signal?.addEventListener("abort", abort, { once: true })
        timer = setTimeout(() => { controller.abort(); reject(new Error("Download timed out")) }, timeoutMs)
      }),
      (async () => {
        const response = await fetch(url, { signal: controller.signal, credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store" })
        if (!response.ok) throw new Error("News service is unavailable")
        if (Number(response.headers.get("content-length")) > maxBytes) throw new Error("Download exceeds the size limit")
        reader = response.body?.getReader()
        const chunks: Uint8Array[] = []
        let length = 0
        if (reader) {
          while (true) {
            const part = await reader.read()
            if (part.done) break
            length += part.value.byteLength
            if (length > maxBytes) throw new Error("Download exceeds the size limit")
            chunks.push(part.value)
          }
        }
        const bytes = new Uint8Array(length)
        let offset = 0
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
        return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
      })(),
    ])
  } finally {
    controller.abort()
    clearTimeout(timer)
    if (abort) signal?.removeEventListener("abort", abort)
    if (reader) {
      const activeReader = reader
      void activeReader.cancel().catch(() => undefined).finally(() => activeReader.releaseLock())
    }
  }
}
