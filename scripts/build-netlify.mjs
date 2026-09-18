import {mkdir,copyFile,cp,readFile,writeFile} from 'node:fs/promises';
await mkdir('netlify/public',{recursive:true});
await writeFile('netlify/public/.keep','All application routes require authentication.\n');
await mkdir('netlify/site',{recursive:true});
// Explicit allowlist: never copy the project root, .env, SQLite, or generated reports.
for(const name of ['index.html','app.js','style.css','manifest.webmanifest','icon-192.png','icon-512.png'])await copyFile(`app/static/${name}`,`netlify/site/${name}`);
await cp('app/static/brand','netlify/site/brand',{recursive:true});
await mkdir('netlify/site/vendor/pdfjs',{recursive:true});
for(const name of ['pdf.mjs','pdf.worker.mjs'])await copyFile(`node_modules/pdfjs-dist/build/${name}`,`netlify/site/vendor/pdfjs/${name}`);
for(const folder of ['standard_fonts','cmaps','wasm'])await cp(`node_modules/pdfjs-dist/${folder}`,`netlify/site/vendor/pdfjs/${folder}`,{recursive:true});
let html=await readFile('netlify/site/index.html','utf8');
html=html.replace('Lokale Anwendung','Mitarbeitertest · Netlify');
await writeFile('netlify/site/index.html',html);
console.log('Netlify build ready. Static allowlist only; no secrets or local data copied.');
