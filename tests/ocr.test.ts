import {it,expect} from 'vitest';
import {OCRSession} from '../src/ocr';
import type {Worker} from 'tesseract.js';
type Runtime=Pick<Worker,'recognize'|'terminate'>;
it('WASM 메모리 오류 시 새 scalar 엔진과 작은 이미지로 한 번 복구',async()=>{
    const modes:boolean[]=[],images:boolean[]=[];let terminated=0;
    const session=new OCRSession(async scalar=>{modes.push(scalar);return {recognize:async()=>{if(!scalar)throw Error('Out of bounds memory access');return {data:{text:'success'}};},terminate:async()=>{terminated++;}} as unknown as Runtime;},()=>{});
    const result=await session.recognize(async retry=>{images.push(retry);return new Blob();});
    expect(result.data.text).toBe('success');expect(modes).toEqual([false,true]);expect(images).toEqual([false,true]);expect(terminated).toBe(1);await session.terminate();
});
it('일반 오류는 재시도하지 않음',async()=>{let created=0;const session=new OCRSession(async()=>{created++;return {recognize:async()=>{throw Error('invalid image');},terminate:async()=>{}} as unknown as Runtime;},()=>{});await expect(session.recognize(async()=>new Blob())).rejects.toThrow('invalid image');expect(created).toBe(1);await session.terminate();});
it('복구도 실패하면 반복하지 않고 파일 오류 반환',async()=>{let created=0;const session=new OCRSession(async()=>{created++;return {recognize:async()=>{throw Error('Out of bounds memory access');},terminate:async()=>{}} as unknown as Runtime;},()=>{});await expect(session.recognize(async()=>new Blob())).rejects.toThrow('Out of bounds');expect(created).toBe(2);await session.terminate();});
