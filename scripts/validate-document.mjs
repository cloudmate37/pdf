// Optional local regression for a real document. Never writes to the input file.
import {readFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,basename} from 'node:path';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
const path=process.argv[2];if(!path)throw Error('Usage: node scripts/validate-document.mjs /path/to/document.pdf');
const digest=async()=>createHash('sha256').update(await readFile(path)).digest('hex');const before=await digest();await mkdir('.tmp',{recursive:true});
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--port','4179','--strictPort'],{stdio:'ignore'});
let browser,timer;
try{for(let attempt=0;attempt<30;attempt++){try{if((await fetch('http://127.0.0.1:4179/pdf/')).ok)break;}catch{}await new Promise(r=>setTimeout(r,300));}
  browser=await chromium.launch();const page=await browser.newPage();const ocrRequests=[];page.on('request',r=>{if(r.url().includes('/vendor/ocr/'))ocrRequests.push(r.url());});
  await page.goto('http://127.0.0.1:4179/pdf/');await page.locator('#file-input').setInputFiles(resolve(path));await page.locator('#run').click();
  timer=setInterval(async()=>{console.log(await page.locator('.job-info p').textContent().catch(()=>''));},30000);
  await page.locator('.badge').filter({hasText:/완료|변경 없음|처리 실패/}).waitFor({timeout:3600000});
  const state=await page.locator('.badge').textContent();console.log(state,await page.locator('.job-info p').textContent());
  if(state==='처리 실패')throw Error(await page.locator('.job-info p').textContent());
  if(ocrRequests.length)throw Error('TOC-only mode requested OCR assets');
  if(state==='완료'){const next=page.waitForEvent('download');await page.locator('.download').click();await (await next).saveAs('.tmp/validation-'+basename(path));}
  console.log('PASS: TOC-only without OCR, original SHA-256 unchanged');
}finally{clearInterval(timer);await browser?.close();server.kill('SIGTERM');if(before!==await digest())throw Error('Original input file changed');}
