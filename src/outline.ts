import type { Entry, Heading, Box } from './types';
export const clean = (s: string) => s.replace(/\s+/gu, ' ').trim();
export function numberedDepth(title: string): number | undefined {
    if (/^(?:제\s*)?[0-9一二三四五六七八九十百]+\s*장(?:\s|$)|^chapter\s+[\divxlcdm]+(?:\s|[.:]|$)/i.test(title))
        return 1;
    if (/^(?:제\s*)?[0-9一二三四五六七八九十百]+\s*절(?:\s|$)/u.test(title))
        return 2;
    const match = title.match(/^(\d+(?:\.\d+)*)(?:[.)]?\s+|[.)]$)/);
    if (match)
        return match[1].split('.').length;
    if (/^(?:[IVXLC]+[.)]|[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+[.]?)\s+/iu.test(title))
        return 1;
}
export function extractOutline(input: Heading[], pageCount: number, title = '', bounds?: Box[]): {
    entries: Entry[];
    ambiguous: boolean;
} {
    const tocPages = new Set(input.filter(h => /^(목\s*차|차례|contents|table of contents)$/i.test(clean(h.title))).map(h => h.pageIndex));
    let candidates = input.map(h => ({ ...h, title: clean(h.title), depth: numberedDepth(clean(h.title)) })).filter(h => {
        if (!h.title || h.title.length > 240 || !Number.isInteger(h.pageIndex) || h.pageIndex < 0 || h.pageIndex >= pageCount || !Number.isFinite(h.x) || !Number.isFinite(h.y))
            return false;
        if (tocPages.has(h.pageIndex) || /\.{2,}\s*\d+\s*$|…+\s*\d+\s*$/.test(h.title))
            return false;
        if (/^(?:그림|표|도표|figure|fig\.|table)\s*[\dIVX]+(?:\s|[.:]|$)/i.test(h.title))
            return false;
        if (/^(?:제\s*)?[\d一二三四五六七八九十]+\s*[부편](?:\s|$)|^(?:part|volume)\s+[\divxlcdm]+(?:\s|[.:]|$)/i.test(h.title))
            return false;
        return h.title.toLocaleLowerCase() !== clean(title).toLocaleLowerCase();
    });
    const position = (h: Heading) => `${h.title}|${Math.round(h.x / 4)}|${Math.round(h.y / 4)}`;
    const margins = new Map<string, Set<number>>();
    for (const h of candidates) {
        const b = bounds?.[h.pageIndex] ?? { x: 0, y: 0, width: 612, height: 792 };
        if (h.y >= b.y + b.height * .95 || h.y <= b.y + b.height * .05) {
            const key = position(h);
            if (!margins.has(key))
                margins.set(key, new Set());
            margins.get(key)!.add(h.pageIndex);
        }
    }
    candidates = candidates.filter(h => (margins.get(position(h))?.size ?? 0) < Math.max(3, Math.ceil(pageCount * .3)));
    let levels = [...new Set(candidates.flatMap(h => h.level ? [h.level] : []))].sort((a, b) => a - b);
    if (levels.length > 1) {
        const shallow = candidates.filter(h => h.level === levels[0]);
        if (shallow.length === 1 && shallow[0] === candidates[0] && shallow[0].pageIndex === 0 && shallow[0].depth === undefined)
            candidates.shift();
    }
    levels = [...new Set(candidates.flatMap(h => h.level ? [h.level] : []))].sort((a, b) => a - b);
    const fonts = [...new Set(candidates.map(h => h.font).filter(f => f > 0))].sort((a, b) => b - a);
    const seen = new Set<string>();
    const entries: Entry[] = [];
    for (const h of candidates) {
        const depth = h.depth ?? (h.level && levels.length > 1 ? levels.indexOf(h.level) + 1 : fonts.length > 1 ? fonts.indexOf(h.font) + 1 : 1);
        if (depth > 2)
            continue;
        const key = `${h.title}|${h.pageIndex}|${h.x.toFixed(1)}|${h.y.toFixed(1)}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        const e: Entry = { title: h.title, pageIndex: h.pageIndex, x: h.x, y: h.y, children: [] };
        if (depth === 2 && entries.length)
            entries.at(-1)!.children.push(e);
        else
            entries.push(e);
    }
    return { entries, ambiguous: !!candidates.length && levels.length <= 1 && fonts.length <= 1 && candidates.some(h => h.depth === undefined) };
}
