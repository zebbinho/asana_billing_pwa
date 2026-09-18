import PDFDocument from 'pdfkit';
import {zipSync,strToU8} from 'fflate';

const number=n=>Number(n).toLocaleString('de-DE',{maximumFractionDigits:2});
const date=s=>s.split('-').reverse().join('.');
export async function pdfReport(model) {
  const doc=new PDFDocument({size:'A4',margin:45,bufferPages:true,info:{Title:`Dienstleistungsübersicht – ${model.customer}`,Author:'apenio GmbH'}});
  doc.registerFont('regular','Helvetica');
  doc.registerFont('bold','Helvetica-Bold');
  const chunks=[];
  const output=new Promise((ok,fail)=>{doc.on('data',c=>chunks.push(c));doc.on('end',()=>ok(Buffer.concat(chunks)));doc.on('error',fail);});
  let y=45;
  function heading(title,subtitle){doc.font('bold').fontSize(14).text(title,45,y,{width:505});y=doc.y+10;doc.fontSize(19).text(model.customer,45,y,{width:505});y=doc.y+10;doc.font('regular').fontSize(10).text(subtitle,45,y);y=doc.y+20;}
  // Wrap cells into explicit lines so even an unusually long row can span pages.
  function wrap(value,width){const text=String(value??'');const lines=[];for(const paragraph of text.split('\n')){let line='';for(const word of paragraph.split(/\s+/)){let part=word;if(doc.widthOfString(part)>width){if(line){lines.push(line);line='';}let fragment='';for(const char of part){if(doc.widthOfString(fragment+char)>width){lines.push(fragment);fragment='';}fragment+=char;}line=fragment;continue;}if(line && doc.widthOfString(line+' '+part)>width){lines.push(line);line=part;}else line+=(line?' ':'')+part;}lines.push(line);}return lines.length?lines:[''];}
  function table(headers,widths,rows,right=[]){
    const header=()=>{doc.font('bold').fontSize(8.5);let x=45;const cells=headers.map((h,i)=>wrap(h,widths[i]-8));const h=Math.max(...cells.map(c=>c.length))*11+10;cells.forEach((lines,i)=>{lines.forEach((line,n)=>doc.text(line,x+4,y+4+n*11,{width:widths[i]-8,lineBreak:false}));x+=widths[i];});y+=h;doc.moveTo(45,y).lineTo(550,y).lineWidth(.5).stroke();y+=4;};
    header();
    for(const row of rows){doc.font('regular').fontSize(8.5);const cells=row.map((v,i)=>wrap(v,widths[i]-8));let offset=0;const length=Math.max(...cells.map(c=>c.length));while(offset<length){let room=Math.floor((780-y-10)/11);if(room<1){doc.addPage();y=45;header();doc.font('regular').fontSize(8.5);room=Math.floor((780-y-10)/11);}const count=Math.min(room,length-offset);let x=45;cells.forEach((lines,i)=>{lines.slice(offset,offset+count).forEach((line,n)=>doc.text(line,x+4,y+4+n*11,{width:widths[i]-8,lineBreak:false,align:right.includes(i)?'right':'left'}));x+=widths[i];});y+=count*11+8;offset+=count;}}
  }
  heading('Dienstleistungsübersicht im apenio Projekt:',`vom: ${date(model.start)} bis: ${date(model.end)}`);
  const lines=[...model.lines].sort((a,b)=>`${a.date}${a.employee_name}${a.task_name}`.localeCompare(`${b.date}${b.employee_name}${b.task_name}`));
  table(['Arbeitspaket','Mitarbeiter','am','Kommentar','Std.'],[125,80,65,195,40],[...lines.map(r=>[r.work_package,r.employee_name,date(r.date),r.comment,number(r.hours)]),['','','','Summe',number(model.summary.monthly_hours)]],[4]);
  doc.addPage();y=45;
  heading('apenio Projekt:',`Auswertung der Budgets bis zum: ${date(model.end)}`);
  const totals=['commissioned_hours','delivered_hours','remaining_hours'].map(k=>number(model.budgets.reduce((n,b)=>n+b[k],0)));
  table(['Budget','beauftragt (h)','erbracht (h)','offen (h)'],[280,75,75,75],[...model.budgets.map(b=>[b.budget_name,number(b.commissioned_hours),number(b.delivered_hours),number(b.remaining_hours)]),['Summen',...totals]],[1,2,3]);
  const pages=doc.bufferedPageRange();
  for(let p=0;p<pages.count;p++){doc.switchToPage(p);doc.page.margins.bottom=0;doc.font('regular').fontSize(8).text(`apenio GmbH, ${new Date().toLocaleDateString('de-DE')}`,45,800,{lineBreak:false}).text(`Dienstleistungsübersicht · Seite ${p+1} von ${pages.count}`,270,800,{width:280,align:'right',lineBreak:false});}
  doc.end();return output;
}
export function csv(rows,fields){const quote=v=>'"'+String(v??'').replaceAll('"','""')+'"';return '\uFEFF'+[fields,...rows.map(r=>fields.map(f=>r[f]))].map(row=>row.map(quote).join(';')).join('\r\n');}
export function reportFiles(model,pdf){
  const raw=['time_entry_gid','date','employee_gid','employee_name','project_gid','project_name','task_gid','task_name','description','minutes','hours','billable_status'];
  const files={
    'customer_service_report.pdf':new Uint8Array(pdf),
    '01_time_entries_raw.csv':strToU8(csv(model.lines,raw)),
    '03_billing_lines.csv':strToU8(csv(model.lines,[...raw,'asana_budget','budget_name','budget_source','work_package','comment'])),
    '04_budget_summary.csv':strToU8(csv(model.budgets,['budget_name','commissioned_hours','delivered_hours','remaining_hours'])),
    'run_summary.json':strToU8(JSON.stringify(model.summary,null,2)),
  };
  return {...files,'report_package.zip':zipSync(files,{level:6})};
}
