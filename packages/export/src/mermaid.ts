import type { BlockNode, DocNode } from "@jangka/shared/document";

/** Replaces each `mermaidBlock` source with `fn(source)`, at any depth; other nodes are kept. */
export function mapMermaid(doc: DocNode, fn: (source: string) => string): DocNode {
  const visit = (node: BlockNode): BlockNode => {
    switch (node.type) {
      case "mermaidBlock":
        return { ...node, attrs: { source: fn(node.attrs.source) } };
      case "blockquote":
        return { ...node, content: node.content.map(visit) };
      case "bulletList":
      case "orderedList":
        return {
          ...node,
          content: node.content.map((item) => ({ ...item, content: item.content.map(visit) })),
        };
      case "table":
        return {
          ...node,
          content: node.content.map((row) => ({
            ...row,
            content: row.content.map((cell) => ({ ...cell, content: cell.content.map(visit) })),
          })),
        };
      default:
        return node;
    }
  };
  return doc.content ? { ...doc, content: doc.content.map(visit) } : doc;
}

/** Non-blank Mermaid sources in document order. */
export function mermaidBlocks(doc: DocNode): string[] {
  const sources: string[] = [];
  mapMermaid(doc, (source) => {
    if (source.trim()) sources.push(source);
    return source;
  });
  return sources;
}
