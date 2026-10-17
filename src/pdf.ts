import { PDFDocument, EncryptedPDFError, PDFName, PDFDict, PDFArray, PDFRef, PDFHexString, PDFString, PDFNumber, PDFNull, pushGraphicsState, popGraphicsState, beginText, endText, setFontAndSize, setTextMatrix, showText, setTextRenderingMode, TextRenderingMode } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { Box, Entry, OCRLine } from './types';
export async function openWritable(bytes: Uint8Array) {
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: true }).catch(error => { if (error instanceof EncryptedPDFError || (error instanceof Error && error.message.includes('Input document to `PDFDocument.load` is encrypted')))
        throw Error('암호화된 PDF는 처리하지 않습니다.'); throw error; });
    if (pdf.isEncrypted)
        throw Error('암호화된 PDF는 처리하지 않습니다.');
    for (const [, object] of pdf.context.enumerateIndirectObjects())
        if (object instanceof PDFDict) {
            const field = object.get(PDFName.of('FT'));
            const type = object.get(PDFName.of('Type'));
            if (field?.toString() === '/Sig' || type?.toString() === '/Sig' || (object.has(PDFName.of('ByteRange')) && object.has(PDFName.of('Contents'))))
                throw Error('서명된 PDF는 처리하지 않습니다.');
        }
    if (pdf.catalog.has(PDFName.of('Perms')))
        throw Error('서명·수정 제한이 있는 PDF는 처리하지 않습니다.');
    return pdf;
}
export function putOutline(pdf: PDFDocument, entries: Entry[]) {
    const ctx = pdf.context;
    const root = ctx.obj({ Type: 'Outlines' });
    const rootRef = ctx.register(root);
    function siblings(items: Entry[], parent: PDFRef): {
        first: PDFRef;
        last: PDFRef;
        count: number;
    } | null {
        if (!items.length)
            return null;
        const nodes = items.map(() => ctx.obj({}));
        const refs = nodes.map(n => ctx.register(n));
        let count = items.length;
        items.forEach((e, i) => {
            const page = pdf.getPage(e.pageIndex);
            const b = page.getCropBox();
            const d = nodes[i];
            d.set(PDFName.of('Title'), PDFHexString.fromText(e.title));
            d.set(PDFName.of('Parent'), parent);
            d.set(PDFName.of('Dest'), ctx.obj([page.ref, 'XYZ', Math.max(b.x, Math.min(b.x + b.width, e.x)), Math.max(b.y, Math.min(b.y + b.height, e.y)), PDFNull]));
            if (i)
                d.set(PDFName.of('Prev'), refs[i - 1]);
            if (i + 1 < refs.length)
                d.set(PDFName.of('Next'), refs[i + 1]);
            const children = siblings(e.children, refs[i]);
            if (children) {
                d.set(PDFName.of('First'), children.first);
                d.set(PDFName.of('Last'), children.last);
                d.set(PDFName.of('Count'), PDFNumber.of(children.count));
                count += children.count;
            }
        });
        return { first: refs[0], last: refs.at(-1)!, count };
    }
    const list = siblings(entries, rootRef);
    if (!list)
        throw Error('생성된 목차가 없습니다.');
    root.set(PDFName.of('First'), list.first);
    root.set(PDFName.of('Last'), list.last);
    root.set(PDFName.of('Count'), PDFNumber.of(list.count));
    pdf.catalog.set(PDFName.of('Outlines'), rootRef);
}
export async function addOCR(pdf: PDFDocument, pages: Map<number, OCRLine[]>, fontBytes: Uint8Array) {
    pdf.registerFontkit(fontkit);
    const font = await pdf.embedFont(fontBytes, { subset: true });
    for (const [index, words] of pages) {
        const page = pdf.getPage(index);
        const fontKey = page.node.newFontDictionary(font.name, font.ref);
        for (const word of words) {
            if (!word.text.trim() || word.box.width <= 0 || word.box.height <= 0)
                continue;
            const angle = word.angle ?? 0;
            const cos = Math.cos(angle), sin = Math.sin(angle);
            const size = word.box.height * .88;
            const natural = font.widthOfTextAtSize(word.text, size);
            if (!natural)
                continue;
            page.pushOperators(pushGraphicsState(), beginText(), setFontAndSize(fontKey, size), setTextRenderingMode(TextRenderingMode.Invisible), setTextMatrix(cos * word.box.width / natural, sin * word.box.width / natural, -sin, cos, word.box.x - sin * word.box.height * .16, word.box.y + cos * word.box.height * .16), showText(font.encodeText(word.text)), endText(), popGraphicsState());
        }
    }
}
export function geometry(pdf: PDFDocument): Box[] { return pdf.getPages().map(p => p.getCropBox()); }
// Canonical PDF-object signatures catch annotation/form/outline changes independently
// of visual rendering. References are retained by loading the existing document.
export function objectValue(pdf: PDFDocument, obj: unknown, seen = new Set<string>(), depth = 0): unknown {
    if (depth > 32)
        throw Error('문서 객체 계층이 너무 깊어 안전하게 검증할 수 없습니다.');
    if (obj instanceof PDFRef) {
        const resolved = pdf.context.lookup(obj);
        if (resolved instanceof PDFDict && resolved.get(PDFName.of('Type'))?.toString() === '/Page')
            return { page: pdf.getPages().findIndex(p => p.ref.toString() === obj.toString()) };
        const key = obj.toString();
        if (seen.has(key))
            return { ref: key };
        const next = new Set(seen);
        next.add(key);
        return objectValue(pdf, pdf.context.lookup(obj), next, depth + 1);
    }
    if (obj instanceof PDFDict) {
        const result: Record<string, unknown> = {};
        for (const [k, v] of [...obj.entries()].sort((a, b) => a[0].toString().localeCompare(b[0].toString()))) {
            if (['P', 'Parent'].includes(k.decodeText()))
                continue;
            result[k.decodeText()] = objectValue(pdf, v, seen, depth + 1);
        }
        return result;
    }
    if (obj instanceof PDFArray)
        return obj.asArray().map(x => objectValue(pdf, x, seen, depth + 1));
    if (obj instanceof PDFString || obj instanceof PDFHexString)
        return obj.decodeText();
    if (obj instanceof PDFNumber)
        return Math.round(obj.asNumber() * 1e6) / 1e6;
    // Streams include appearance bytes, not only their dictionary.
    if (obj && typeof obj === 'object' && 'getContents' in obj) {
        const stream = obj as {
            getContents: () => Uint8Array;
            dict: PDFDict;
        };
        return { dict: objectValue(pdf, stream.dict, seen, depth + 1), bytes: Array.from(stream.getContents()) };
    }
    return obj?.toString() ?? null;
}
export function preservation(pdf: PDFDocument) { return JSON.stringify({ pages: pdf.getPages().map(p => ({ media: p.getMediaBox(), crop: p.getCropBox(), rotation: p.getRotation().angle, annots: objectValue(pdf, p.node.get(PDFName.of('Annots'))) })), forms: objectValue(pdf, pdf.catalog.get(PDFName.of('AcroForm'))) }); }
export function outlineObjects(pdf: PDFDocument) { return JSON.stringify(objectValue(pdf, pdf.catalog.get(PDFName.of('Outlines')))); }
