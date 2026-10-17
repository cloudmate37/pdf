import { describe, it, expect } from 'vitest';
import { extractOutline } from '../src/outline';
import type { Heading } from '../src/types';
const h = (title: string, page: number, level: number | undefined = 1, y = 700, font = 20): Heading => ({ title, pageIndex: page - 1, level, x: 60, y, font, order: 0 });
const extract = (nodes: Heading[], title = '') => extractOutline(nodes, 12, title).entries;
describe('기존 목차 규칙 이식', () => {
    it('한국어 장과 절', () => { const r = extract([h('제1장 시작', 2), h('제1절 배경', 3), h('제2절 방법', 4), h('제2장 결론', 8)]); expect(r.map(x => x.title)).toEqual(['제1장 시작', '제2장 결론']); expect(r[0].children).toHaveLength(2); expect(r[0].children[0].pageIndex).toBe(2); });
    it('잘못된 스타일보다 번호 우선', () => { const r = extract([h('1. Introduction', 2), h('1.1 Background', 3), h('1.1.1 Detail', 3), h('2. Methods', 5)]); expect(r).toHaveLength(2); expect(r[0].children).toHaveLength(1); });
    it('표지 제목 제거 및 계층 재설정', () => { const r = extract([h('Book Title', 1), h('Introduction', 2, 2), h('Background', 3, 3), h('Methods', 5, 2)]); expect(r.map(x => x.title)).toEqual(['Introduction', 'Methods']); expect(r[0].children[0].title).toBe('Background'); });
    it('목차 페이지·캡션·부 제목 제외', () => { const r = extract([h('목차', 1), h('제1장 시작', 1), h('제1부 이론', 2), h('제1장 시작', 3), h('표 1 결과', 4)]); expect(r.map(x => x.title)).toEqual(['제1장 시작']); expect(r[0].pageIndex).toBe(2); });
    it('같은 위치만 중복 제거', () => { const r = extract([h('1. Start', 2), h('1.1 Summary', 3), h('1.1 Summary', 3), h('2. End', 7), h('2.1 Summary', 8)]); expect(r[0].children).toHaveLength(1); expect(r[1].children).toHaveLength(1); });
    it('반복 머리말 제외', () => { const r = extract([...Array.from({ length: 12 }, (_, i) => h('Journal Header', i + 1, 1, 790)), h('1. Introduction', 2, 1, 600)]); expect(r.map(x => x.title)).toEqual(['1. Introduction']); });
    it('실제 PDF 페이지 목적지', () => { const r = extract([h('Start', 4, 1, 700, 24), h('Detail', 6, 2, 700, 18)]); expect(r[0].children[0].pageIndex).toBe(5); });
    it('범위 밖·비정상 좌표 제외', () => expect(extract([h('1. Bad', 99), h('2. Bad', 2, 1, NaN)])).toEqual([]));
    it('글자 크기 계층', () => { const r = extract([h('Start', 2, 1, 700, 24), h('Details', 3, 1, 700, 18), h('End', 7, 1, 700, 24)]); expect(r[0].children[0].title).toBe('Details'); });
    it('다른 장의 같은 절 제목 유지', () => { const r = extract(Array.from({ length: 4 }, (_, i) => [h(`제${i + 1}장`, i * 2 + 1), h('요약', i * 2 + 2, 2)]).flat()); expect(r).toHaveLength(4); expect(r.every(x => x.children.length === 1)).toBe(true); });
    it('불충분한 제목 계층은 애매함 표시', () => expect(extractOutline([h('Only heading', 2)], 12).ambiguous).toBe(true));
    it('문서 제목 자체 제외', () => expect(extract([h('제목', 2)], '제목')).toEqual([]));
});
