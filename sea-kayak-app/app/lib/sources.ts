export type RouteItem = {
  url: string
  title: string
  description: string
  published?: string
  citation?: string
}

const TITLE_PREFIX_SOURCE: Record<string, string> = {
  "SAL Prac": "SAL Practitioner",
  SAcLJ: "SAcLJ",
  "Asian JM": "Asian JM",
}

function sourceFromTitle(title: string): string {
  const m = title.match(/^\[([^\]]+)\]/)
  if (!m) return ""
  return TITLE_PREFIX_SOURCE[m[1].trim()] || ""
}

export function getSource(url: string, title: string = ""): string {
  try {
    const u = new URL(url)
    const h = u.hostname.replace(/^www\./, "").toLowerCase()
    const path = u.pathname.toLowerCase()
    if (h.endsWith("singaporelawwatch.sg")) return "Singapore Law Watch"
    if (h.endsWith("mlaw.gov.sg")) return "MinLaw"
    if (h.endsWith("mas.gov.sg")) return "MAS"
    if (h.endsWith("agc.gov.sg")) return "AGC"
    if (h.endsWith("allenandgledhill.com")) return "Allen & Gledhill"
    if (h.endsWith("wongpartnership.com")) return "WongPartnership"
    if (h.endsWith("withersworldwide.com")) return "Withers"
    if (h.endsWith("dentons.rodyk.com") || h.endsWith("rodyk.com")) return "Dentons Rodyk"
    if (h.endsWith("twobirds.com")) return "Bird & Bird"
    if (h.endsWith("harryelias.com")) return "Harry Elias"
    if (h.endsWith("leenlee.com.sg")) return "Lee & Lee"
    if (h.endsWith("lawgazette.com.sg")) return "Law Gazette"
    if (
      h.endsWith("singaporeinternationalarbitration.wordpress.com") ||
      h.endsWith("singaporeinternationalarbitration.com")
    )
      return "SG Arbitration Blog"
    if (h.endsWith("lexology.com")) return "Lexology"
    if (h.endsWith("blog.nus.edu.sg")) return "NUS Law Research"
    if (h.endsWith("law.nus.edu.sg")) return "NUS Law"
    if (h.endsWith("journalsonline.academypublishing.org.sg")) return "SAL Academy"
    if (h.endsWith("academypublishing.org.sg")) return "SAL Academy"
    if (h.endsWith("events.sal.sg")) return "SAL Events"
    if (h.endsWith("sal.org.sg")) return "SAL"
    if (h.endsWith("store.lawnet.com") || h.endsWith("lawnet.com")) return "LawNet"
    if (h.endsWith("hungryhippo.huey.xyz")) {
      if (path.includes("sal-practitioner")) return "SAL Practitioner"
      if (path.includes("sal-journal")) return "SAL Journal"
      if (path.includes("law.nus.edu.sg/trail")) return "NUS TRAIL"
      return sourceFromTitle(title)
    }
    return sourceFromTitle(title)
  } catch {
    return sourceFromTitle(title)
  }
}

export function normalizeRouteData(data: unknown): RouteItem[] {
  if (!Array.isArray(data)) return []
  return data.map((d: unknown): RouteItem =>
    typeof d === "string"
      ? { url: d, title: "", description: "", published: "", citation: "" }
      : {
          url: (d as RouteItem).url,
          title: (d as RouteItem).title || "",
          description: (d as RouteItem).description || "",
          published: (d as RouteItem).published || "",
          citation: (d as RouteItem).citation || "",
        },
  )
}
