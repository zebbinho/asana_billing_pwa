import {zipFunctions} from '@netlify/zip-it-and-ship-it';
import {resolve} from 'node:path';
const config={'*':{nodeBundler:'esbuild',nodeVersion:'24',externalNodeModules:['pdfkit'],includedFiles:['netlify/site/**','app/static/brand/*.woff2'],includedFilesBasePath:process.cwd()}};
const built=await zipFunctions('netlify/functions',resolve('../../work/netlify-bundles'),{basePath:process.cwd(),repositoryRoot:process.cwd(),config});
console.log(JSON.stringify(built.map(f=>({name:f.name,runtime:f.runtime,size:f.size,path:f.path})),null,2));
