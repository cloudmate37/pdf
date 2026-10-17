import type { PDFPageProxy, TextItem, StructTreeNode, TextMarkedContent } from 'pdfjs-dist/types/src/display/api';
import type { Heading, OCRLine, Box } from './types';
import { clean, numberedDepth } from './outline';
export interface Analysis {
    tagged: Heading[];
    layout: Heading[];
    text: string;
}
export async function analyze(page: PDFPageProxy, index: number): Promise<Analysis> {
    const content = await page.getTextContent({ includeMarkedContent: true });
    const taggedGroups = new Map<string, TextItem[]>();
    const stack: string[] = [];
    const items: TextItem[] = [];
    for (const token of content.items) {
        if ('str' in token) {
            items.push(token);
            for (const id of stack) {
                if (!taggedGroups.has(id))
                    taggedGroups.set(id, []);
                taggedGroups.get(id)!.push(token);
            }
        }
        else {
            const marker = token as TextMarkedContent;
            if (marker.type === 'endMarkedContent')
                stack.pop();
            else
                stack.push(marker.id ?? '');
        }
    }
    const tagged: Heading[] = [];
    const tree = await page.getStructTree();
    function visit(n: StructTreeNode) {
        if (/^H[1-6]$/.test(n.role)) {
            const ids: string[] = [];
            const collect = (node: StructTreeNode) => { for (const child of node.children) {
                if ('id' in child)
                    ids.push(child.id);
                else
                    collect(child);
            } };
            collect(n);
            const group = ids.flatMap(id => taggedGroups.get(id) ?? []);
            if (group.length) {
                const x = Math.min(...group.map(t => t.transform[4]));
                const y = Math.max(...group.map(t => t.transform[5] + Math.hypot(t.transform[2], t.transform[3])));
                tagged.push({ title: clean(group.map(t => t.str).join(' ')), pageIndex: index, x, y, font: Math.max(...group.map(t => Math.hypot(t.transform[2], t.transform[3]))), level: Number(n.role[1]), order: tagged.length });
            }
        }
        else
            for (const child of n.children)
                if ('role' in child)
                    visit(child);
    }
    if (tree)
        visit(tree);
    const rows: TextItem[][] = [];
    for (const t of items) {
        if (!clean(t.str))
            continue;
        const last = rows.at(-1);
        const h = Math.hypot(t.transform[2], t.transform[3]);
        const prev = last?.at(-1);
        if (prev && Math.abs(prev.transform[5] - t.transform[5]) < Math.max(h, prev.height) * .35 && t.transform[4] - (prev.transform[4] + prev.width) < Math.max(h, prev.height) * 4)
            last!.push(t);
        else
            rows.push([t]);
    }
    const histogram = new Map<number, number>();
    for (const t of items) {
        const size = Math.round(Math.hypot(t.transform[2], t.transform[3]) * 2) / 2;
        histogram.set(size, (histogram.get(size) ?? 0) + t.str.length);
    }
    const body = [...histogram].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 12;
    const layout: Heading[] = [];
    for (const row of rows) {
        const title = clean(row.map(t => t.str).join(' '));
        const font = Math.round(Math.max(...row.map(t => Math.hypot(t.transform[2], t.transform[3]))) * 2) / 2;
        const numbered = numberedDepth(title);
        const style = content.styles[row[0].fontName];
        const bold = /bold|black|heavy|semibold/i.test((style?.fontFamily ?? '') + ' ' + row[0].fontName);
        if (title.length <= 240 && title.length >= 2 && (numbered !== undefined || font >= body * 1.18 || (bold && title.length < 100 && !/[.!?。]$/.test(title))))
            layout.push({ title, pageIndex: index, x: Math.min(...row.map(t => t.transform[4])), y: Math.max(...row.map(t => t.transform[5] + font)), font, order: layout.length });
    }
    return { tagged, layout, text: clean(items.map(t => t.str).join(' ')) };
}
export function ocrHeadings(lines: OCRLine[], index: number, bounds: Box): Heading[] {
    if (!lines.length)
        return [];
    // Glyph sizes in the recognized line boxes provide the typography fallback.
    const heights = lines.map(l => l.box.height).sort((a, b) => a - b);
    const body = heights[Math.floor(heights.length / 2)];
    return lines.filter(l => numberedDepth(clean(l.text)) !== undefined || (l.box.height > body * 1.22 && l.text.length < 180) || /^(목\s*차|차례|contents|table of contents)$/i.test(clean(l.text))).map((l, i) => ({ title: clean(l.text), pageIndex: index, x: l.box.x, y: l.box.y + l.box.height, font: Math.round(l.box.height * 2) / 2, order: i })).filter(h => h.x >= bounds.x - 1 && h.y <= bounds.y + bounds.height + 1);
}
