/// <reference lib="webworker" />
import * as pdfjs from 'pdfjs-dist';
import { createWorker, OEM, type Worker as OCRWorker } from 'tesseract.js';
import { openWritable, putOutline, addOCR, geometry, preservation, outlineObjects } from './pdf';
import { analyze, ocrHeadings } from './analysis';
import { extractOutline, clean } from './outline';
import type { Entry, Heading, OCRLine, JobRequest, Progress, EngineMessage } from './types';
const scope = self as unknown as DedicatedWorkerGlobalScope;
let canceled = false;
let ocr: OCRWorker | undefined;
let render: ReturnType<pdfjs.PDFPageProxy['render']> | undefined;
const ports: Worker[] = [];
let activeDocs: pdfjs.PDFDocumentProxy[] = [];
let activeTask: pdfjs.PDFDocumentLoadingTask | undefined;
class CanvasFactory {
    create(width: number, height: number) { const canvas = new OffscreenCanvas(Math.ceil(width), Math.ceil(height)); return { canvas, context: canvas.getContext('2d', { willReadFrequently: true })! }; }
    reset(target: {
        canvas: OffscreenCanvas;
    }, width: number, height: number) { target.canvas.width = Math.ceil(width); target.canvas.height = Math.ceil(height); }
    destroy(target: {
        canvas: OffscreenCanvas | null;
        context: OffscreenCanvasRenderingContext2D | null;
    }) { if (target.canvas) {
        target.canvas.width = 0;
        target.canvas.height = 0;
    } target.canvas = null; target.context = null; }
}
class WorkerFilterFactory {
    addFilter(maps: unknown) { if (maps)
        throw Error('이 PDF의 색상 필터는 브라우저 처리에서 지원하지 않습니다.'); return 'none'; }
    addHCMFilter() { return 'none'; }
    addHighlightHCMFilter() { return 'none'; }
    addAlphaFilter() { throw Error('이 PDF의 투명도 필터는 안전하게 검증할 수 없습니다.'); }
    addLuminosityFilter() { throw Error('이 PDF의 밝기 마스크는 안전하게 검증할 수 없습니다.'); }
    destroy() { }
}
function check() { if (canceled)
    throw Error('작업을 취소했습니다.'); }
const normalized = (s: string) => s.normalize('NFKC').replace(/\s+/gu, '');
async function open(bytes: Uint8Array, base: string) {
    check();
    const port = new Worker(base + 'vendor/pdf/pdf.worker.min.mjs', { type: 'module' });
    ports.push(port);
    const worker = new pdfjs.PDFWorker({ port: port as never });
    activeTask = pdfjs.getDocument({ worker, useWorkerFetch: true, FilterFactory: WorkerFilterFactory as never, data: bytes.slice(), CanvasFactory: CanvasFactory as never, disableFontFace: true, useSystemFonts: false,
        cMapUrl: base + 'vendor/pdf/cmaps/', cMapPacked: true, standardFontDataUrl: base + 'vendor/pdf/standard_fonts/', wasmUrl: base + 'vendor/pdf/wasm/', isEvalSupported: false, stopAtErrors: true });
    activeTask.onPassword = () => { void activeTask?.destroy(); };
    const doc = await activeTask.promise;
    activeDocs.push(doc);
    check();
    return doc;
}
async function raster(page: pdfjs.PDFPageProxy, scale: number, rotation = page.rotate) {
    check();
    const viewport = page.getViewport({ scale, rotation });
    if (viewport.width * viewport.height > 40000000)
        throw Error('페이지가 너무 커서 안전하게 처리할 수 없습니다.');
    const canvas = new OffscreenCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext('2d', { willReadFrequently: true })!;
    render = page.render({ canvas: canvas as never, canvasContext: context as never, viewport, annotationMode: pdfjs.AnnotationMode.ENABLE, intent: 'print' });
    await render.promise;
    check();
    return { canvas, context, viewport };
}
async function hashPage(page: pdfjs.PDFPageProxy) { const { canvas, context } = await raster(page, 1); try {
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    const hash = await crypto.subtle.digest('SHA-256', image.data);
    return `${canvas.width}x${canvas.height}:` + Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}
finally {
    canvas.width = 0;
    canvas.height = 0;
} }
async function validOutline(doc: pdfjs.PDFDocumentProxy) { const roots = await doc.getOutline(); let count = 0; async function visit(items: NonNullable<typeof roots>) { for (const item of items) {
    try {
        let dest = item.dest;
        if (typeof dest === 'string')
            dest = await doc.getDestination(dest);
        if (dest) {
            const index = typeof dest[0] === 'number' ? dest[0] : await doc.getPageIndex(dest[0]);
            if (index >= 0 && index < doc.numPages && clean(item.title))
                count++;
        }
    }
    catch { /* A malformed destination is not usable. */ }
    await visit(item.items);
} } if (roots)
    await visit(roots); return count > 0; }
async function verifyOutline(doc: pdfjs.PDFDocumentProxy, entries: Entry[]) { const roots = await doc.getOutline(); async function visit(actual: NonNullable<typeof roots>, expected: Entry[]): Promise<void> { if (actual.length !== expected.length)
    throw Error('목차 항목 수 검증 실패'); for (let i = 0; i < actual.length; i++) {
    const a = actual[i], e = expected[i];
    let d = a.dest;
    if (typeof d === 'string')
        d = await doc.getDestination(d);
    if (!d)
        throw Error('목차 이동 위치 없음');
    const index = typeof d[0] === 'number' ? d[0] : await doc.getPageIndex(d[0]);
    if (a.title !== e.title || index !== e.pageIndex || d[1]?.name !== 'XYZ' || Math.abs(d[2] - e.x) > .1 || Math.abs(d[3] - e.y) > .1)
        throw Error('목차 제목·페이지·좌표 검증 실패');
    await visit(a.items, e.children);
} } await visit(roots ?? [], entries); }
async function process(job: JobRequest) {
    const send = (message: EngineMessage, transfer: Transferable[] = []) => scope.postMessage(message, transfer);
    const progress = (p: Progress) => { check(); send({ type: 'progress', id: job.id, progress: p }); };
    pdfjs.GlobalWorkerOptions.workerSrc = job.base + 'vendor/pdf/pdf.worker.min.mjs';
    if (typeof OffscreenCanvas === 'undefined')
        throw Error('이 브라우저는 페이지 처리를 지원하지 않습니다. 최신 Chrome·Edge·Safari를 사용하세요.');
    progress({ stage: 'inspect', message: 'PDF 구조와 수정 가능 여부 확인 중…' });
    const source = new Uint8Array(await job.file.arrayBuffer());
    const writable = await openWritable(source);
    const doc = await open(source, job.base);
    const existingOutline = await validOutline(doc);
    const wantsToc = job.mode !== 'ocr' && !existingOutline;
    const wantsOCR = job.mode !== 'toc';
    if (!wantsToc && !wantsOCR) {
        send({ type: 'done', id: job.id, bytes: null, summary: '유효한 내장 목차가 있어 변경하지 않았습니다.', entries: [] });
        return;
    }
    const before = preservation(writable);
    const originalOutline = outlineObjects(writable);
    const bounds = geometry(writable);
    const hashes: string[] = [];
    const texts: string[] = [];
    const tagged: Heading[] = [];
    const layout: Heading[] = [];
    const recognized = new Map<number, OCRLine[]>();
    let blank = 0;
    let skipped = 0;
    for (let i = 0; i < doc.numPages; i++) {
        check();
        const page = await doc.getPage(i + 1);
        progress({ stage: 'analyze', message: `${i + 1} / ${doc.numPages} 페이지 분석 중…`, page: i + 1, total: doc.numPages });
        const analysis = await analyze(page, i);
        texts.push(analysis.text);
        hashes.push(await hashPage(page));
        if (wantsToc) {
            tagged.push(...analysis.tagged);
            layout.push(...analysis.layout);
        }
        if (analysis.text) {
            skipped++;
            page.cleanup();
            continue;
        }
        if (!wantsOCR) {
            blank++;
            page.cleanup();
            continue;
        }
        if (!ocr) {
            progress({ stage: 'ocr-model', message: '한국어·영어 OCR 모델 준비 중…' });
            ocr = await createWorker('kor+eng', OEM.LSTM_ONLY, { workerPath: job.base + 'vendor/ocr/worker.min.js', corePath: job.base + 'vendor/ocr/core', langPath: job.base + 'vendor/ocr/lang', gzip: false, workerBlobURL: false, cacheMethod: 'none', logger: m => { if (!canceled && m.status === 'loading language traineddata')
                    progress({ stage: 'ocr-model', message: '한국어·영어 OCR 모델 불러오는 중…' }); } });
            await ocr.setParameters({ preserve_interword_spaces: '1' });
            check();
        }
        progress({ stage: 'ocr', message: `${i + 1} / ${doc.numPages} 페이지 OCR 중…`, page: i + 1, total: doc.numPages });
        const unit = page.getViewport({ scale: 1 });
        const scale = Math.min(3, 5000 / Math.max(unit.width, unit.height));
        let rasterized = await raster(page, scale);
        try {
            let blob = await rasterized.canvas.convertToBlob({ type: 'image/png' });
            let response = await ocr.recognize(blob, {}, { text: true, blocks: true });
            check();
            if (page.rotate !== 0) {
                const alternate = await raster(page, scale, 0);
                const candidate = await ocr.recognize(await alternate.canvas.convertToBlob({ type: 'image/png' }), {}, { text: true, blocks: true });
                check();
                const score = (data: typeof response.data) => data.confidence * Math.sqrt(clean(data.text).length);
                if (score(candidate.data) > score(response.data)) {
                    rasterized.canvas.width = 0;
                    rasterized.canvas.height = 0;
                    rasterized = alternate;
                    response = candidate;
                }
                else {
                    alternate.canvas.width = 0;
                    alternate.canvas.height = 0;
                }
            }
            const { viewport } = rasterized;
            function box(text: string, b: {
                x0: number;
                y0: number;
                x1: number;
                y1: number;
            }): OCRLine {
                const bl = viewport.convertToPdfPoint(b.x0, b.y1), br = viewport.convertToPdfPoint(b.x1, b.y1), tl = viewport.convertToPdfPoint(b.x0, b.y0);
                return { text, box: { x: bl[0], y: bl[1], width: Math.hypot(br[0] - bl[0], br[1] - bl[1]), height: Math.hypot(tl[0] - bl[0], tl[1] - bl[1]) }, angle: Math.atan2(br[1] - bl[1], br[0] - bl[0]) };
            }
            const words: OCRLine[] = [];
            const lines: OCRLine[] = [];
            for (const block of response.data.blocks ?? [])
                for (const paragraph of block.paragraphs)
                    for (const line of paragraph.lines) {
                        if (clean(line.text))
                            lines.push(box(clean(line.text), line.bbox));
                        for (const word of line.words) {
                            if (clean(word.text))
                                words.push(box(word.text, word.bbox));
                        }
                    }
            if (words.length) {
                recognized.set(i, words);
                if (wantsToc)
                    layout.push(...ocrHeadings(lines, i, bounds[i]));
            }
            else
                blank++;
        }
        finally {
            rasterized.canvas.width = 0;
            rasterized.canvas.height = 0;
            page.cleanup();
        }
    }
    let entries: Entry[] = [];
    if (wantsToc) {
        progress({ stage: 'outline', message: '구조 태그와 제목 계층에서 목차 구성 중…' });
        const metadata = await doc.getMetadata();
        const title = (metadata.info as {
            Title?: string;
        })?.Title ?? job.file.name.replace(/\.pdf$/i, '');
        const structured = extractOutline(tagged, doc.numPages, title, bounds);
        const fallback = extractOutline(layout.sort((a, b) => a.pageIndex - b.pageIndex || b.y - a.y || a.x - b.x), doc.numPages, title, bounds);
        const selected = structured.entries.length && !structured.ambiguous ? structured : fallback;
        entries = selected.entries;
        if (!entries.length || selected.ambiguous)
            throw Error(!wantsOCR && blank ? '목차를 생성할 텍스트가 부족합니다. OCR을 선택한 뒤 다시 실행하세요.' : '장·절 계층을 신뢰할 만큼 식별하지 못했습니다. 결과를 저장하지 않았습니다.');
        // Coordinates are clamped once, before both writing and verification.
        const clamp = (items: Entry[]) => { for (const e of items) {
            const b = bounds[e.pageIndex];
            e.x = Math.max(b.x, Math.min(b.x + b.width, e.x));
            e.y = Math.max(b.y, Math.min(b.y + b.height, e.y));
            clamp(e.children);
        } };
        clamp(entries);
        putOutline(writable, entries);
    }
    if (!entries.length && !recognized.size) {
        send({ type: 'done', id: job.id, bytes: null, summary: `추가할 텍스트가 없습니다. 기존 텍스트 ${skipped}페이지, 빈 페이지 ${blank}페이지.`, entries: [] });
        return;
    }
    if (recognized.size) {
        progress({ stage: 'write', message: '검색·복사용 텍스트 레이어 추가 중…' });
        const r = await fetch(job.base + 'vendor/fonts/NotoSansCJKkr-Regular.otf');
        if (!r.ok)
            throw Error('OCR 글꼴을 불러올 수 없습니다.');
        await addOCR(writable, recognized, new Uint8Array(await r.arrayBuffer()));
    }
    check();
    progress({ stage: 'save', message: '결과 PDF 구성 중…' });
    const bytes = await writable.save({ useObjectStreams: false });
    check();
    const checkPDF = await openWritable(bytes);
    if (before !== preservation(checkPDF))
        throw Error('페이지 구조·주석 보존 검증에 실패했습니다.');
    if ((existingOutline || !wantsToc) && outlineObjects(checkPDF) !== originalOutline)
        throw Error('기존 목차 보존 검증에 실패했습니다.');
    const final = await open(bytes, job.base);
    if (final.numPages !== doc.numPages)
        throw Error('페이지 수 검증 실패');
    if (entries.length)
        await verifyOutline(final, entries);
    for (let i = 0; i < doc.numPages; i++) {
        progress({ stage: 'validate', message: `${i + 1} / ${doc.numPages} 페이지 외형·텍스트 검증 중…`, page: i + 1, total: doc.numPages });
        const page = await final.getPage(i + 1);
        if (await hashPage(page) !== hashes[i])
            throw Error(`${i + 1}페이지의 외형이 달라져 결과를 저장하지 않았습니다.`);
        const text = normalized((await analyze(page, i)).text);
        if (recognized.has(i)) {
            const expected = normalized(recognized.get(i)!.map(w => w.text).join(' '));
            if (!expected || text !== expected)
                throw Error(`${i + 1}페이지 OCR 검색 텍스트 검증에 실패했습니다.`);
        }
        else if (text !== normalized(texts[i]))
            throw Error(`${i + 1}페이지 기존 텍스트 보존 검증에 실패했습니다.`);
        page.cleanup();
    }
    const count = entries.reduce((n, e) => n + 1 + e.children.length, 0);
    const summary = [count ? `목차 ${count}개 생성` : existingOutline ? '기존 목차 유지' : '', recognized.size ? `OCR ${recognized.size}페이지` : '', `텍스트 페이지 ${skipped}개 유지`].filter(Boolean).join(' · ');
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    send({ type: 'done', id: job.id, bytes: buffer, summary, entries }, [buffer]);
}
scope.onmessage = async ({ data }: MessageEvent<JobRequest | {
    type: 'cancel';
}>) => {
    if ('type' in data) {
        canceled = true;
        render?.cancel();
        void ocr?.terminate();
        void activeTask?.destroy();
        return;
    }
    try {
        await process(data);
    }
    catch (error) {
        scope.postMessage({ type: 'error', id: data.id, message: canceled ? '작업을 취소했습니다.' : error instanceof Error ? error.message : String(error) } satisfies EngineMessage);
    }
    finally {
        await ocr?.terminate().catch(() => { });
        for (const doc of activeDocs)
            await doc.destroy().catch(() => { });
        activeDocs = [];
        for (const port of ports)
            port.terminate();
        ports.length = 0;
    }
};
