const path = require('node:path');
const asar = require('@electron/asar');

function scanRuntimeDependencies(fileNames, readJson) {
 const files=new Set(fileNames.map(name=>name.replace(/\\/g,'/').replace(/^\/+/,'')));
 const missing=[];const visited=new Set();
 function resolve(from,name){let dir=from;while(true){const candidate=path.posix.join(dir,'node_modules',name,'package.json');if(files.has(candidate))return candidate;if(dir==='.'||dir==='')return null;dir=path.posix.dirname(dir);}}
 function visit(file){if(visited.has(file))return;visited.add(file);const pkg=readJson(file);for(const name of Object.keys(pkg.dependencies||{})){if(pkg.optionalDependencies?.[name])continue;const target=resolve(path.posix.dirname(file),name);if(!target)missing.push(`${pkg.name||file} -> ${name}`);else visit(target);}}
 if(!files.has('package.json'))throw Error('Packaged application package.json missing');
 visit('package.json');return missing;
}
function verifyArchive(archive){const missing=scanRuntimeDependencies(asar.listPackage(archive),file=>JSON.parse(asar.extractFile(archive,file.split("/").join(path.sep)).toString('utf8')));if(missing.length)throw Error('Incomplete packaged runtime dependencies: '+missing.join('; '));console.log('[package-check] Production dependency closure verified');}
module.exports=async context=>{const resources=context.electronPlatformName==='darwin'?path.join(context.appOutDir,context.packager.appInfo.productFilename+'.app','Contents','Resources'):path.join(context.appOutDir,'resources');verifyArchive(path.join(resources,'app.asar'));};
module.exports.scanRuntimeDependencies=scanRuntimeDependencies;
module.exports.verifyArchive=verifyArchive;
if(require.main===module)verifyArchive(process.argv[2]);
