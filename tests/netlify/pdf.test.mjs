import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import {unzipSync,strFromU8} from 'fflate';
import {normalize,reportModel} from '../../netlify/lib/core.mjs';
import {pdfReport,reportFiles} from '../../netlify/lib/pdf.mjs';
import {raw,settings} from './helpers.mjs';
test('PDF und ZIP enthalten Monatsleistungen, Budgets und Auditdateien',async()=>{const model=reportModel([normalize(raw())],settings,{month:'2026-09',project_gid:'p1'},null);const pdf=await pdfReport(model);assert.equal(pdf.subarray(0,4).toString(),'%PDF');const files=reportFiles(model,pdf);const unpacked=unzipSync(files['report_package.zip']);assert.equal(Object.keys(unpacked).length,5);assert.match(strFromU8(unpacked['03_billing_lines.csv']),/local_fallback/);await mkdir('../../work/netlify-qa',{recursive:true});await writeFile('../../work/netlify-qa/report.pdf',pdf);});
test('Sehr lange Kommentare und mehrseitige Tabellen werden vollständig erstellt',async()=>{const rows=Array.from({length:65},(_,i)=>normalize({...raw('e'+i),description:i===0?'Sehr langer Kommentar mit Umlauten äöü. '.repeat(350):`Leistung ${i}`}));const model=reportModel(rows,settings,{month:'2026-09',project_gid:'p1'},null);const pdf=await pdfReport(model);assert.ok(pdf.length>10000);await mkdir('../../work/netlify-qa',{recursive:true});await writeFile('../../work/netlify-qa/long-report.pdf',pdf);});
