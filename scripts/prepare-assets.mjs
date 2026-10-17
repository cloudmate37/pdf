import {mkdir,readFile,writeFile,cp} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {dirname,resolve} from 'node:path';
const require=createRequire(import.meta.url);
const out=resolve('public/vendor');await mkdir(out,{recursive:true});
const pkg=(p)=>dirname(require.resolve(`${p}/package.json`));
for(const [source,dest] of [['pdfjs-dist/build/pdf.worker.min.mjs','pdf/pdf.worker.min.mjs'],['tesseract.js/dist/worker.min.js','ocr/worker.min.js']]){
  await mkdir(resolve(out,dirname(dest)),{recursive:true});await cp(require.resolve(source),resolve(out,dest));
}
for(const folder of ['cmaps','standard_fonts','wasm'])await cp(resolve(pkg('pdfjs-dist'),folder),resolve(out,'pdf',folder),{recursive:true});
await mkdir(resolve(out,'ocr/core'),{recursive:true});
for(const f of ['tesseract-core.wasm.js','tesseract-core.wasm','tesseract-core-lstm.wasm.js','tesseract-core-lstm.wasm','tesseract-core-simd.wasm.js','tesseract-core-simd.wasm','tesseract-core-simd-lstm.wasm.js','tesseract-core-simd-lstm.wasm'])await cp(resolve(pkg('tesseract.js-core'),f),resolve(out,'ocr/core',f));
const lock=JSON.parse(await readFile('scripts/assets-lock.json','utf8'));
for(const item of lock){const path=resolve(out,item.path);await mkdir(dirname(path),{recursive:true});let bytes;try{bytes=await readFile(path);}catch{const r=await fetch(item.url);if(!r.ok)throw Error(`Asset ${r.status}: ${item.url}`);bytes=Buffer.from(await r.arrayBuffer());}
  const digest=createHash('sha256').update(bytes).digest('hex');if(item.sha256 && digest!==item.sha256)throw Error(`Asset checksum mismatch: ${item.path}`);
  if(!item.sha256 && process.argv.includes('--lock'))item.sha256=digest;else if(!item.sha256)throw Error('Missing locked checksum');
  await writeFile(path,bytes);console.log(`${item.path}: ${bytes.length} bytes`);
}
if(process.argv.includes('--lock'))await writeFile('scripts/assets-lock.json',JSON.stringify(lock,null,2)+'\n');
await mkdir('public/licenses',{recursive:true});
for(const p of ['pdfjs-dist','pdf-lib','@pdf-lib/fontkit','tesseract.js','tesseract.js-core']){
  const root=pkg(p);for(const name of ['LICENSE','LICENSE.md','LICENSE.txt']){try{await cp(resolve(root,name),resolve('public/licenses',p.replaceAll('/','-')+'-'+name));break;}catch{}}
}
