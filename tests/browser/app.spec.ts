import { test, expect, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts, PDFName, PDFHexString, degrees, beginMarkedContent, endMarkedContent, PDFDict, PDFOperator, PDFOperatorNames } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { putOutline } from '../../src/pdf';
const output = '.tmp';
async function fixture(korean = false, existing = false) {
    const pdf = await PDFDocument.create();
    pdf.registerFontkit(fontkit);
    const font = korean ? await pdf.embedFont(await readFile('public/vendor/fonts/NotoSansCJKkr-Regular.otf'), { subset: true }) : await pdf.embedFont(StandardFonts.Helvetica);
    for (let i = 0; i < 2; i++) {
        const p = pdf.addPage([612, 792]);
        p.drawText(korean ? `제${i + 1}장 연구 방법` : `Chapter ${i + 1} ${i ? 'Methods' : 'Introduction'}`, { x: 60, y: 710, size: 24, font });
        p.drawText(korean ? '제1절 연구 배경' : '1.1 Background', { x: 60, y: 660, size: 18, font });
        for (let j = 0; j < 8; j++)
            p.drawText(korean ? '연구의 목적과 방법을 검토합니다.' : 'This is the body of the research document.', { x: 60, y: 600 - j * 24, size: 12, font });
    }
    if (existing)
        putOutline(pdf, [{ title: 'Existing chapter', pageIndex: 0, x: 60, y: 710, children: [{ title: 'Existing section', pageIndex: 1, x: 60, y: 660, children: [{ title: 'Deep outline', pageIndex: 1, x: 60, y: 600, children: [] }] }] }]);
    return Buffer.from(await pdf.save());
}
async function scan(page: Page, korean = false) {
    const png = await page.evaluate(async (ko) => {
        const font = new FontFace('FixtureNoto', `url(${location.origin}/pdf/vendor/fonts/NotoSansCJKkr-Regular.otf)`);
        await font.load();
        document.fonts.add(font);
        const c = document.createElement('canvas');
        c.width = 1224;
        c.height = 1584;
        const ctx = c.getContext('2d')!;
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.fillStyle = '#111';
        ctx.font = '52px FixtureNoto';
        ctx.fillText(ko ? '제1장 연구 방법' : 'Chapter 1 Introduction', 120, 180);
        ctx.font = '38px FixtureNoto';
        ctx.fillText(ko ? '제1절 연구 배경' : '1.1 Background', 120, 300);
        ctx.font = '26px FixtureNoto';
        for (let i = 0; i < 8; i++)
            ctx.fillText(ko ? '연구의 목적과 방법을 검토합니다.' : 'This is the body of the research document.', 120, 420 + i * 54);
        return c.toDataURL('image/png').split(',')[1];
    }, korean);
    const pdf = await PDFDocument.create();
    const image = await pdf.embedPng(Buffer.from(png, 'base64'));
    pdf.addPage([612, 792]).drawImage(image, { x: 0, y: 0, width: 612, height: 792 });
    return Buffer.from(await pdf.save());
}
async function upload(page: Page, bytes: Buffer, name = 'document.pdf') { await page.locator('#file-input').setInputFiles({ name, mimeType: 'application/pdf', buffer: bytes }); }
async function complete(page: Page) { await page.locator('#run').click(); await expect(page.locator('.badge')).toHaveText(/완료|처리 실패|변경 없음|취소/, { timeout: 150000 }); const status = await page.locator('.badge').textContent(); if (status === '처리 실패') {
    await page.getByRole('button', { name: '기록', exact: true }).click();
    throw Error(await page.locator('#log-content').innerText());
} return status; }
async function download(page: Page, name: string) { const pending = page.waitForEvent('download'); await page.getByRole('link', { name: '다운로드 ↓' }).click(); const result = await pending; await result.saveAs(`${output}/${name}`); return new Uint8Array(await readFile(`${output}/${name}`)); }
test.beforeAll(async () => { await mkdir(output, { recursive: true }); });
test.beforeEach(async ({ page }) => { await page.goto('./'); });
test('기본 옵션·독립 선택·화면', async ({ page }) => { await expect(page.locator('#toc')).toBeChecked(); await expect(page.locator('#ocr')).not.toBeChecked(); await expect(page.locator('#run')).toBeDisabled(); await upload(page, await fixture()); await expect(page.locator('#run')).toBeEnabled(); await page.locator('#toc').uncheck(); await expect(page.locator('#run')).toBeDisabled(); await page.locator('#ocr').check(); await expect(page.locator('#run')).toBeEnabled(); await page.locator('#toc').check(); await expect(page.locator('#mode-description')).toContainText('OCR 후'); await page.screenshot({ path: `${output}/screen-${test.info().project.name}.png`, fullPage: true }); });
test('영어 목차만 생성, OCR 자산 요청 없음', async ({ page }) => { const requests: string[] = []; page.on('request', r => { if (r.url().includes('/vendor/ocr/'))
    requests.push(r.url()); }); await upload(page, await fixture()); expect(await complete(page)).toBe('완료'); const bytes = await download(page, 'english-toc.pdf'); const pdf = await PDFDocument.load(bytes); expect(pdf.catalog.has(PDFName.of('Outlines'))).toBe(true); expect(requests).toEqual([]); });
test('한국어 목차 생성', async ({ page }) => { await upload(page, await fixture(true)); expect(await complete(page)).toBe('완료'); await download(page, 'korean-toc.pdf'); });
test('기존 목차는 변경하지 않음', async ({ page }) => { await upload(page, await fixture(false, true)); expect(await complete(page)).toBe('변경 없음'); await expect(page.locator('.download')).toHaveCount(0); });
test('OCR 미선택 스캔 실패와 다음 파일 계속', async ({ page }) => { const scanned = await scan(page); await page.locator('#file-input').setInputFiles([{ name: 'scan.pdf', mimeType: 'application/pdf', buffer: scanned }, { name: 'text.pdf', mimeType: 'application/pdf', buffer: await fixture() }]); await page.locator('#run').click(); await expect(page.locator('.badge').nth(0)).toHaveText('처리 실패', { timeout: 150000 }); await expect(page.locator('.badge').nth(1)).toHaveText('완료', { timeout: 150000 }); await expect(page.locator('.job').nth(0)).toContainText('OCR'); });
test('한국어 OCR과 기존 목차·주석·회전·크롭 보존, 중복 방지', async ({ page }) => {
    test.setTimeout(240000);
    const source = await PDFDocument.load(await scan(page, true));
    const p = source.getPage(0);
    p.setCropBox(20, 30, 570, 730);
    const annotation = source.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [60, 60, 80, 80], Contents: PDFHexString.fromText('보존 주석') });
    p.node.addAnnot(source.context.register(annotation));
    putOutline(source, [{ title: '기존 목차', pageIndex: 0, x: 60, y: 710, children: [] }]);
    // Test a sideways display caused by page rotation; OCR should recover direction.
    const [rot] = await source.copyPages(source, [0]);
    source.addPage(rot);
    rot.setRotation(degrees(90));
    await upload(page, Buffer.from(await source.save()), 'korean-scan.pdf');
    await page.locator('#toc').uncheck();
    await page.locator('#ocr').check();
    expect(await complete(page)).toBe('완료');
    const bytes = await download(page, 'korean-ocr.pdf');
    const result = await PDFDocument.load(bytes);
    expect(result.getPageCount()).toBe(2);
    expect(result.getPage(0).getCropBox()).toEqual(p.getCropBox());
    expect(result.catalog.has(PDFName.of('Outlines'))).toBe(true);
    await page.locator('#clear').click();
    await upload(page, Buffer.from(bytes), 'rerun.pdf');
    expect(await complete(page)).toBe('변경 없음');
});
test('영어 OCR 후 목차 생성과 혼합 페이지', async ({ page }) => { test.setTimeout(240000); const source = await PDFDocument.load(await scan(page)); const text = await PDFDocument.load(await fixture()); source.addPage((await source.copyPages(text, [1]))[0]); await upload(page, Buffer.from(await source.save()), 'mixed.pdf'); await page.locator('#ocr').check(); expect(await complete(page)).toBe('완료'); await download(page, 'mixed-both.pdf'); });
test('처리 취소 시 결과 없음', async ({ page }) => { const scanned = await scan(page); await upload(page, scanned, 'cancel.pdf'); await page.locator('#ocr').check(); await page.locator('#run').click(); await expect(page.locator('#cancel')).toBeVisible(); await page.locator('#cancel').click(); await expect(page.locator('.badge')).toHaveText('취소', { timeout: 10000 }); await expect(page.locator('.download')).toHaveCount(0); });
test('서명 PDF 거부', async ({ page }) => { const pdf = await PDFDocument.load(await fixture()); pdf.context.register(pdf.context.obj({ FT: 'Sig' })); await upload(page, Buffer.from(await pdf.save()), 'signed.pdf'); await page.locator('#run').click(); await expect(page.locator('.badge')).toHaveText('처리 실패'); await expect(page.locator('.job')).toContainText('서명'); });
test('빈 페이지 OCR은 변경 없음', async ({ page }) => { const pdf = await PDFDocument.create(); pdf.addPage([612, 792]); await upload(page, Buffer.from(await pdf.save()), 'blank.pdf'); await page.locator('#toc').uncheck(); await page.locator('#ocr').check(); expect(await complete(page)).toBe('변경 없음'); });
test('암호화 PDF 거부', async ({ page }) => { await upload(page, await readFile('tests/fixtures/encrypted.pdf'), 'encrypted.pdf'); await page.locator('#run').click(); await expect(page.locator('.badge')).toHaveText('처리 실패'); await expect(page.locator('.job')).toContainText('암호화'); });
test('스타일이 같아도 구조 태그로 계층 식별', async ({ page }) => {
    const doc = await PDFDocument.create();
    const p = doc.addPage([612, 792]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const root = doc.context.obj({ Type: 'StructTreeRoot' });
    const rootRef = doc.context.register(root);
    const refs = [];
    for (const [i, title] of ['Introduction', 'Background', 'Methods'].entries()) {
        const elem = doc.context.obj({ Type: 'StructElem', S: i === 1 ? 'H2' : 'H1', P: rootRef, Pg: p.ref, K: i });
        refs.push(doc.context.register(elem));
        p.pushOperators(PDFOperator.of(PDFOperatorNames.BeginMarkedContentSequence, [PDFName.of(i === 1 ? 'H2' : 'H1'), doc.context.obj({ MCID: i }) as never]));
        p.drawText(title, { x: 60, y: 710 - i * 60, size: 12, font });
        p.pushOperators(endMarkedContent());
    }
    for (let i = 0; i < 8; i++)
        p.drawText('This is the body of the document.', { x: 60, y: 550 - i * 20, size: 12, font });
    root.set(PDFName.of('K'), doc.context.obj(refs));
    root.set(PDFName.of('ParentTree'), doc.context.register(doc.context.obj({ Nums: [0, refs] })));
    p.node.set(PDFName.of('StructParents'), doc.context.obj(0));
    doc.catalog.set(PDFName.of('StructTreeRoot'), rootRef);
    doc.catalog.set(PDFName.of('MarkInfo'), doc.context.obj({ Marked: true }));
    await upload(page, Buffer.from(await doc.save()), 'tagged.pdf');
    expect(await complete(page)).toBe('완료');
    const result = await PDFDocument.load(await download(page, 'tagged-toc.pdf'));
    expect(result.catalog.has(PDFName.of('StructTreeRoot'))).toBe(true);
});
