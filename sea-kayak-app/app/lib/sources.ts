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
    const hostMatches = (domain: string) => h === domain || h.endsWith(`.${domain}`)
    if (hostMatches("singaporelawwatch.sg")) return "Singapore Law Watch"
    if (hostMatches("mlaw.gov.sg")) return "MinLaw"
    if (hostMatches("mas.gov.sg")) return "MAS"
    if (hostMatches("smulexicon.com")) return "SMU Lexicon"
    if (hostMatches("elitigation.sg") || hostMatches("judiciary.gov.sg")) return "SG Courts"
    if (hostMatches("pdpc.gov.sg")) return "PDPC"
    if (hostMatches("ccs.gov.sg") || hostMatches("cccs.gov.sg")) return "CCS"
    if (hostMatches("agc.gov.sg")) return "AGC"
    if (hostMatches("allenandgledhill.com")) return "Allen & Gledhill"
    if (hostMatches("wongpartnership.com")) return "WongPartnership"
    if (hostMatches("withersworldwide.com")) return "Withers"
    if (hostMatches("dentons.rodyk.com") || hostMatches("rodyk.com")) return "Dentons Rodyk"
    if (hostMatches("twobirds.com")) return "Bird & Bird"
    if (hostMatches("harryelias.com")) return "Harry Elias"
    if (hostMatches("leenlee.com.sg")) return "Lee & Lee"
    if (hostMatches("lawgazette.com.sg")) return "Law Gazette"
    if (
      hostMatches("singaporeinternationalarbitration.wordpress.com") ||
      hostMatches("singaporeinternationalarbitration.com")
    )
      return "SG Arbitration Blog"
    if (hostMatches("lexology.com")) return "Lexology"
    if (hostMatches("blog.nus.edu.sg")) return "NUS Law Research"
    if (hostMatches("law.nus.edu.sg")) return "NUS Law"
    if (hostMatches("journalsonline.academypublishing.org.sg")) return "SAL Academy"
    if (hostMatches("academypublishing.org.sg")) return "SAL Academy"
    if (hostMatches("events.sal.sg")) return "SAL Events"
    if (hostMatches("sal.org.sg")) return "SAL"
    if (hostMatches("store.lawnet.com") || hostMatches("lawnet.com")) return "LawNet"
    if (hostMatches("hungryhippo.huey.xyz")) {
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
  const items: RouteItem[] = []
  const seen = new Set<string>()
  for (const value of data) {
    const raw: unknown = typeof value === "string" ? { url: value } : value
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue
    const item = raw as Record<string, unknown>
    if (typeof item.url !== "string") continue
    const url = item.url.trim()
    if (/[\u0000-\u0020\u007f]/.test(url)) continue
    if ([item.title, item.description, item.published, item.citation].some(field => field != null && typeof field !== "string")) continue
    try {
      const parsed = new URL(url)
      if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) continue
      parsed.hash = ""
      if (seen.has(parsed.href)) continue
      seen.add(parsed.href)
    } catch {
      continue
    }
    items.push({
      url,
      title: typeof item.title === "string" ? item.title : "",
      description: typeof item.description === "string" ? item.description : "",
      published: typeof item.published === "string" ? item.published : "",
      citation: typeof item.citation === "string" ? item.citation : "",
    })
  }
  return items
}
