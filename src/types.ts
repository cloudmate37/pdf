export type Mode = 'toc' | 'ocr' | 'both';
export interface Heading {
    title: string;
    pageIndex: number;
    x: number;
    y: number;
    level?: number;
    font: number;
    depth?: number;
    order: number;
}
export interface Entry {
    title: string;
    pageIndex: number;
    x: number;
    y: number;
    children: Entry[];
}
export interface Box {
    x: number;
    y: number;
    width: number;
    height: number;
}
export interface OCRLine {
    text: string;
    box: Box;
    angle?: number;
}
export interface Progress {
    stage: string;
    message: string;
    page?: number;
    total?: number;
}
export interface JobRequest {
    id: string;
    file: File;
    mode: Mode;
    base: string;
}
export type EngineMessage = {
    type: 'progress';
    id: string;
    progress: Progress;
} | {
    type: 'done';
    id: string;
    bytes: ArrayBuffer | null;
    summary: string;
    entries: Entry[];
} | {
    type: 'error';
    id: string;
    message: string;
};
