import {it,expect} from 'vitest';
import {analyze} from '../src/analysis';
import {extractOutline} from '../src/outline';
import type {PDFPageProxy} from 'pdfjs-dist';
it('본문 크기의 Contents 표식으로 인쇄 목차 페이지 제외',async()=>{
    const token=(str:string,y:number)=>({str,transform:[12,0,0,12,60,y],fontName:'body',width:200,height:12});
    const page={getTextContent:async()=>({items:[token('Contents',700),token('Chapter 1 Introduction',650)],styles:{body:{fontFamily:'sans-serif'}}}),getStructTree:async()=>null} as unknown as PDFPageProxy;
    const analysis=await analyze(page,0);
    expect(analysis.layout.some(h=>h.title==='Contents')).toBe(true);
    const actual={title:'Chapter 1 Introduction',pageIndex:1,x:60,y:700,font:24,order:0};
    const entries=extractOutline([...analysis.layout,actual],2).entries;
    expect(entries).toHaveLength(1);expect(entries[0].pageIndex).toBe(1);
});
