import { readFile, writeFile, rename, rm } from "node:fs/promises"
import { fileURLToPath } from "node:url"

const input = fileURLToPath(new URL("../../data/routes.json", import.meta.url))
const output = fileURLToPath(new URL("../public/routes.json", import.meta.url))
const bytes = await readFile(input)
if (bytes.length > 16 * 1024 * 1024) throw new Error("News snapshot exceeds the supported size")
const data = JSON.parse(bytes.toString("utf8"))
if (!Array.isArray(data) || !data.length) throw new Error("Build requires a non-empty news snapshot")
const temporary = `${output}.${process.pid}.tmp`
try {
  await writeFile(temporary, bytes)
  await rename(temporary, output)
} finally {
  await rm(temporary, { force: true })
}
