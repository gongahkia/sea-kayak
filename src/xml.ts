/** Strict, namespace-aware in-memory XML. Never treats input as a filename or fetches entities. */
import { SaxesParser } from "saxes";
import { RetryableError, TerminalError } from "./retry.ts";

export interface XmlNode {
  name: string;
  uri: string;
  attributes: Record<string, string>;
  children: XmlNode[];
  content: (string | XmlNode)[];
}

export function detectEncoding(body: Buffer, contentType = ""): string {
  return /charset=["']?([\w-]+)/i.exec(contentType)?.[1].toLowerCase() ??
    /encoding=["']([\w-]+)["']/i.exec(body.subarray(0, 200).toString("ascii"))?.[1].toLowerCase() ?? "utf-8";
}

export function parseXml(body: Buffer, contentType = ""): XmlNode {
  const parser = new SaxesParser({ xmlns: true });
  const stack: XmlNode[] = [];
  let root: XmlNode | undefined, count = 0;
  parser.on("opentag", tag => {
    if (++count > 100_000 || stack.length >= 256) throw new TerminalError("XML feed exceeds the structure limit");
    const node: XmlNode = {
      name: tag.local, uri: tag.uri, attributes: Object.create(null), children: [], content: [],
    };
    for (const attribute of Object.values(tag.attributes)) {
      if (attribute.uri === "http://www.w3.org/2000/xmlns/") continue;
      node.attributes[attribute.uri ? `{${attribute.uri}}${attribute.local}` : attribute.local] = attribute.value;
    }
    const parent = stack.at(-1);
    if (parent) { parent.children.push(node); parent.content.push(node); }
    else root = node;
    stack.push(node);
  });
  parser.on("closetag", () => { stack.pop(); });
  const addText = (text: string) => { stack.at(-1)?.content.push(text); };
  parser.on("text", addText);
  parser.on("cdata", addText);
  try {
    // TextDecoder handles BOMs. UTF-16 without a declaration is also legal XML.
    let encoding = detectEncoding(body, contentType);
    if (body[0] === 0xff && body[1] === 0xfe) encoding = "utf-16le";
    if (body[0] === 0xfe && body[1] === 0xff) encoding = "utf-16be";
    parser.write(new TextDecoder(encoding, { fatal: true }).decode(body)).close();
  } catch (error) {
    if (error instanceof TerminalError) throw error;
    throw new RetryableError("Response is not a complete RSS or Atom document", { cause: error });
  }
  if (!root) throw new RetryableError("Response is not a complete RSS or Atom document");
  return root;
}

export function xmlText(node?: XmlNode): string {
  return node?.content.map(part => typeof part === "string" ? part : xmlText(part)).join("") ?? "";
}

export function* descendants(node: XmlNode): Generator<XmlNode> {
  yield node;
  for (const child of node.children) yield* descendants(child);
}
