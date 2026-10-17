import './style.css';
import type { EngineMessage, Mode, Progress } from './types';
type Status = 'waiting' | 'running' | 'done' | 'skipped' | 'error' | 'canceled';
interface Job {
    id: string;
    file: File;
    status: Status;
    message: string;
    url?: string;
    count?: number;
    logs: string[];
    progress?: Progress;
}
const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
<header class="topbar"><a class="brand" href="./" aria-label="PDF 목차 생성기 처음으로"><img src="${import.meta.env.BASE_URL}assets/app-icon.png" alt="" width="42" height="42"><span>문서 도구<span class="brand-sub">PDF 목차 생성기</span></span></a><span class="private"><span class="dot"></span> 파일 업로드 없이 처리</span></header>
<main><section class="intro"><p class="eyebrow">YOUR DOCUMENT, BETTER CONNECTED</p><h1>긴 문서에 길을 만들다.</h1><p class="lead">목차로 원하는 곳을 찾고,<br class="mobile"> OCR로 스캔 문서를 검색하세요.</p></section>
<div class="workspace"><section class="files-panel panel" aria-labelledby="files-title"><div class="panel-heading"><div><p class="step">01 · 문서</p><h2 id="files-title">PDF 선택</h2></div><button id="clear" class="text-button" disabled>목록 비우기</button></div>
<label id="drop" class="dropzone" for="file-input" role="button" tabindex="0" aria-label="PDF 파일 선택"><span class="document-icon" aria-hidden="true">↓</span><strong>PDF 파일을 여기에 놓으세요</strong><span>또는 클릭해서 여러 파일 선택</span><span class="choose">파일 선택</span></label><input id="file-input" type="file" accept="application/pdf,.pdf" multiple class="sr-only" tabindex="-1">
<div class="list-heading"><span id="file-count">선택한 파일 없음</span><span>원본 파일은 유지됩니다</span></div><ul id="jobs" class="jobs"></ul><div id="empty" class="empty">선택한 PDF의 진행 상황과 결과가 여기에 표시됩니다.</div>
</section><aside class="options-panel panel" aria-labelledby="options-title"><p class="step">02 · 처리 옵션</p><h2 id="options-title">필요한 기능만 선택</h2>
<label class="option"><input id="toc" type="checkbox" checked><span><strong>목차 생성</strong><small>장·절 제목을 찾아 PDF에 이동 가능한 목차를 추가합니다.</small></span></label>
<label class="option"><input id="ocr" type="checkbox"><span><strong>OCR</strong><small>스캔 페이지에 한국어·영어 검색과 복사를 위한 텍스트를 추가합니다.</small></span></label>
<p id="mode-description" class="mode-description">목차만 생성합니다. OCR은 실행하지 않습니다.</p>
<button id="run" class="primary" disabled>처리 시작 <span aria-hidden="true">→</span></button><button id="cancel" class="secondary" hidden>작업 취소</button>
<p class="save-note">완료 후 결과 PDF를 다운로드하세요.<br>기존 목차와 텍스트는 보존합니다.</p><div class="local-note"><span aria-hidden="true">◉</span><p><strong>문서는 내 기기에만</strong><small>PDF 내용은 서버로 전송되지 않습니다. 이 탭을 열어 둔 채 처리 완료를 기다려 주세요.</small></p></div>
</aside></div>
<section class="how"><div><span class="how-number">01</span><p><strong>문서를 선택하고</strong><span>한 번에 여러 PDF를 추가하세요.</span></p></div><div><span class="how-number">02</span><p><strong>필요한 기능을 고르면</strong><span>기존 목차·텍스트는 유지합니다.</span></p></div><div><span class="how-number">03</span><p><strong>새 PDF로 다운로드</strong><span>검증을 통과한 결과만 제공합니다.</span></p></div></section>
<div id="announcement" class="sr-only" role="status" aria-live="polite"></div>
<details class="help"><summary>사용 전 알아두세요</summary><p>OCR 모델은 처음 사용할 때 불러옵니다. 스캔 품질과 문서 구조에 따라 인식 결과가 달라질 수 있습니다. 텍스트가 조금이라도 있는 페이지는 OCR을 건너뜁니다. 암호화·서명 PDF는 처리하지 않습니다.</p><p>큰 문서는 시간이 오래 걸리거나 기기의 메모리 한계로 처리되지 않을 수 있습니다. 페이지를 닫으면 진행 중인 작업과 아직 다운로드하지 않은 결과가 사라집니다.</p><p>목차 생성은 문서의 구조 태그와 제목 모양을 분석합니다. 복잡한 문서에서는 Mac 앱과 결과가 다를 수 있습니다.</p></details>
</main><footer><span>PDF 목차 생성기</span><a href="https://github.com/cloudmate37/pdf" target="_blank" rel="noreferrer">GitHub ↗</a></footer>
<dialog id="log-dialog"><div class="dialog-heading"><h2>처리 기록</h2><button id="close-log" aria-label="닫기">닫기</button></div><pre id="log-content"></pre></dialog>`;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const toc = $<HTMLInputElement>('toc'), ocr = $<HTMLInputElement>('ocr'), run = $<HTMLButtonElement>('run'), cancel = $<HTMLButtonElement>('cancel');
const input = $<HTMLInputElement>('file-input'), drop = $('drop'), clear = $<HTMLButtonElement>('clear');
const jobs: Job[] = [];
let running = false, canceled = false, worker: Worker | undefined, current: Job | undefined;
const labels: Record<Status, string> = { waiting: '대기', running: '처리 중', done: '완료', skipped: '변경 없음', error: '처리 실패', canceled: '취소' };
const size = (bytes: number) => bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
function announce(text: string) { $('announcement').textContent = text; }
function update() {
    const waiting = jobs.some(j => j.status === 'waiting');
    run.disabled = running || !waiting || (!toc.checked && !ocr.checked);
    toc.disabled = ocr.disabled = running;
    clear.disabled = running || !jobs.length;
    input.disabled = running;
    cancel.hidden = !running;
    run.textContent = running ? '처리 중…' : '처리 시작 →';
    drop.classList.toggle('disabled', running);
    drop.setAttribute('aria-disabled', String(running));
    $('file-count').textContent = jobs.length ? `${jobs.length}개 파일` : '선택한 파일 없음';
    $('empty').hidden = jobs.length > 0;
    $('mode-description').textContent = toc.checked ? (ocr.checked ? 'OCR 후 목차를 생성합니다. 두 작업을 함께 검증합니다.' : '목차만 생성합니다. OCR은 실행하지 않습니다.') : (ocr.checked ? 'OCR만 실행합니다. 기존 목차는 그대로 유지합니다.' : '실행할 기능을 하나 이상 선택하세요.');
    const list = $('jobs');
    list.replaceChildren();
    for (const job of jobs) {
        const li = document.createElement('li');
        li.className = 'job';
        const badge = document.createElement('span');
        badge.className = `badge ${job.status}`;
        badge.textContent = labels[job.status];
        const info = document.createElement('div');
        info.className = 'job-info';
        const name = document.createElement('strong');
        name.textContent = job.file.name;
        name.title = job.file.name;
        const meta = document.createElement('span');
        meta.className = 'job-meta';
        meta.textContent = size(job.file.size);
        const message = document.createElement('p');
        message.textContent = job.message;
        info.append(name, meta, message);
        if (job.status === 'running') {
            const bar = document.createElement('progress');
            bar.setAttribute('aria-label', '현재 단계 진행률');
            if (job.progress?.total) {
                bar.max = job.progress.total;
                bar.value = job.progress.page ?? 0;
            }
            info.append(bar);
        }
        const actions = document.createElement('div');
        actions.className = 'job-actions';
        if (job.url) {
            const link = document.createElement('a');
            link.className = 'download';
            link.href = job.url;
            link.download = job.file.name.replace(/\.pdf$/i, '') + '_처리완료.pdf';
            link.textContent = '다운로드 ↓';
            actions.append(link);
        }
        if (job.logs.length) {
            const log = document.createElement('button');
            log.className = 'text-button';
            log.textContent = '기록';
            log.onclick = () => { $('log-content').textContent = job.logs.join('\n'); $<HTMLDialogElement>('log-dialog').showModal(); };
            actions.append(log);
        }
        if (!running) {
            if (job.status === 'error' || job.status === 'canceled') {
                const retry = document.createElement('button');
                retry.className = 'text-button';
                retry.textContent = '다시 대기';
                retry.onclick = () => { job.status = 'waiting'; job.message = '다시 처리할 준비가 되었습니다.'; update(); };
                actions.append(retry);
            }
            const remove = document.createElement('button');
            remove.className = 'remove';
            remove.textContent = '×';
            remove.setAttribute('aria-label', `${job.file.name} 제거`);
            remove.onclick = () => { if (job.url)
                URL.revokeObjectURL(job.url); jobs.splice(jobs.indexOf(job), 1); job.logs = []; update(); };
            actions.append(remove);
        }
        li.append(badge, info, actions);
        list.append(li);
    }
}
function add(files: FileList | File[]) { if (running)
    return; let rejected = 0; for (const file of files) {
    if (!/\.pdf$/i.test(file.name)) {
        rejected++;
        continue;
    }
    jobs.push({ id: crypto.randomUUID(), file, status: 'waiting', message: '처리할 준비가 되었습니다.', logs: [] });
} input.value = ''; announce(rejected ? `PDF 파일만 추가할 수 있습니다. ${rejected}개 제외.` : '파일을 추가했습니다.'); update(); }
input.onchange = () => { if (input.files)
    add(input.files); };
for (const event of ['dragenter', 'dragover'])
    drop.addEventListener(event, e => { e.preventDefault(); if (!running)
        drop.classList.add('dragging'); });
for (const event of ['dragleave', 'drop'])
    drop.addEventListener(event, e => { e.preventDefault(); drop.classList.remove('dragging'); });
drop.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && !running) {
    e.preventDefault();
    input.click();
} });
drop.addEventListener('drop', e => { if (e.dataTransfer)
    add(e.dataTransfer.files); });
toc.onchange = ocr.onchange = update;
clear.onclick = () => { for (const j of jobs)
    if (j.url)
        URL.revokeObjectURL(j.url); jobs.length = 0; update(); };
$('close-log').onclick = () => $<HTMLDialogElement>('log-dialog').close();
async function execute(job: Job, mode: Mode) {
    return new Promise<void>(resolve => {
        job.status = 'running';
        current = job;
        worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
        let settled = false;
        let cancelTimer: ReturnType<typeof setTimeout> | undefined;
        const finish = () => { if (settled)
            return; settled = true; if (cancelTimer)
            clearTimeout(cancelTimer); worker?.terminate(); worker = undefined; current = undefined; update(); resolve(); };
        worker.onmessage = ({ data }: MessageEvent<EngineMessage>) => {
            if (settled || data.id !== job.id)
                return;
            if (data.type === 'progress') {
                job.progress = data.progress;
                job.message = data.progress.message;
                job.logs.push(data.progress.message);
                update();
            }
            else if (data.type === 'done') {
                if (canceled) {
                    job.status = 'canceled';
                    job.message = '작업을 취소했습니다.';
                    finish();
                    return;
                }
                job.status = data.bytes ? 'done' : 'skipped';
                job.message = data.summary;
                job.logs.push(data.summary);
                job.count = data.entries.length;
                if (data.bytes)
                    job.url = URL.createObjectURL(new Blob([data.bytes], { type: 'application/pdf' }));
                announce(`${job.file.name}: ${job.message}`);
                finish();
            }
            else {
                job.status = canceled ? 'canceled' : 'error';
                job.message = data.message;
                job.logs.push(data.message);
                announce(job.message);
                finish();
            }
        };
        worker.onerror = e => { if (settled)
            return; job.status = canceled ? 'canceled' : 'error'; job.message = canceled ? '작업을 취소했습니다.' : '문서를 처리할 수 없습니다. 메모리가 부족하거나 지원되지 않는 PDF일 수 있습니다.'; job.logs.push(e.message || job.message); finish(); };
        // A hard-stop fallback releases even an unresponsive OCR/PDF worker.
        const stop = () => { if (current === job) {
            job.status = 'canceled';
            job.message = '작업을 취소했습니다.';
            job.logs.push(job.message);
            finish();
        } };
        cancel.onclick = () => { canceled = true; worker?.postMessage({ type: 'cancel' }); cancel.disabled = true; cancelTimer = setTimeout(stop, 1000); };
        worker.postMessage({ id: job.id, file: job.file, mode, base: new URL(import.meta.env.BASE_URL, location.href).href });
        update();
    });
}
run.onclick = async () => {
    if (run.disabled)
        return;
    running = true;
    canceled = false;
    cancel.disabled = false;
    const mode: Mode = toc.checked ? (ocr.checked ? 'both' : 'toc') : 'ocr';
    update();
    for (const job of jobs.filter(j => j.status === 'waiting')) {
        if (canceled) {
            job.status = 'canceled';
            job.message = '시작하기 전에 취소했습니다.';
            continue;
        }
        await execute(job, mode);
    }
    running = false;
    update();
    announce(canceled ? '작업을 취소했습니다.' : '모든 파일의 처리가 끝났습니다.');
};
window.addEventListener('beforeunload', e => { if (running || jobs.some(j => j.url)) {
    e.preventDefault();
} });
update();
