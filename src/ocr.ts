import type {Worker} from 'tesseract.js';
type Runtime = Pick<Worker, 'recognize' | 'terminate'>;
export class OCRSession {
    private worker?: Runtime;
    private scalar = false;
    private closed = false;
    constructor(private factory: (scalar: boolean) => Promise<Runtime>, private recovery: () => void) {}
    private async getWorker() {
        if (this.closed) throw Error('작업을 취소했습니다.');
        if (!this.worker) {
            const worker = await this.factory(this.scalar);
            if (this.closed) { await worker.terminate(); throw Error('작업을 취소했습니다.'); }
            this.worker = worker;
        }
        return this.worker;
    }
    async recognize(image: (retry: boolean) => Promise<Blob>) {
        const worker = await this.getWorker();
        try {
            return await worker.recognize(await image(false), {}, {text:true, blocks:true});
        } catch (error) {
            if (this.closed || !/out of bounds|memory access|out of memory|memory allocation/i.test(String(error))) throw error;
            // A failed WASM instance must not be reused. Retry once using the
            // scalar core and a smaller raster, preserving its new coordinate map.
            await worker.terminate();
            this.worker = undefined;
            this.scalar = true;
            this.recovery();
            const fresh = await this.getWorker();
            return fresh.recognize(await image(true), {}, {text:true, blocks:true});
        }
    }
    async terminate() {
        this.closed = true;
        const worker = this.worker;
        this.worker = undefined;
        await worker?.terminate();
    }
}
