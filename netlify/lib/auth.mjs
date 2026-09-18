import {createHash,timingSafeEqual,createHmac} from 'node:crypto';
const digest=s=>createHash('sha256').update(s).digest();
const equal=(a,b)=>timingSafeEqual(digest(a),digest(b));
export const securityHeaders = {'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'SAMEORIGIN','Referrer-Policy':'same-origin'};
export function authenticate(request,env=process.env) {
  if (!env.TEST_USERNAME || !env.TEST_PASSWORD || env.TEST_PASSWORD.length<24) return Response.json({detail:'Der Testzugang ist noch nicht eingerichtet.'},{status:503,headers:securityHeaders});
  let user='',password='';
  const header=request.headers.get('authorization')||'';
  if(/^Basic /i.test(header)) {
    const decoded=Buffer.from(header.slice(6),'base64').toString('utf8'), split=decoded.indexOf(':');
    if(split>=0){user=decoded.slice(0,split);password=decoded.slice(split+1);}
  }
  const userOk=equal(user,env.TEST_USERNAME),passwordOk=equal(password,env.TEST_PASSWORD);
  if(!userOk||!passwordOk)return Response.json({detail:'Bitte mit dem Testzugang anmelden.'},{status:401,headers:{...securityHeaders,'WWW-Authenticate':'Basic realm="apenio Mitarbeitertest", charset="UTF-8"'}});
  if(!['GET','HEAD','OPTIONS'].includes(request.method) && request.headers.get('origin')!==new URL(request.url).origin) return Response.json({detail:'Bitte direkt in der Testanwendung arbeiten.'},{status:403,headers:securityHeaders});
  return null;
}
// Internal workers receive a job-bound signature, never the Asana token or browser password.
export function jobSignature(job,env=process.env){return createHmac('sha256',env.TEST_PASSWORD||'').update('billing-job:'+job).digest('hex');}
export function workerAllowed(request,job,env=process.env){return !!env.TEST_PASSWORD && env.TEST_PASSWORD.length>=24 && equal(request.headers.get('x-billing-job-signature')||'',jobSignature(job,env));}
