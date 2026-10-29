const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
function verifyRelease(directory,version){
 const proof=JSON.parse(fs.readFileSync(path.join(directory,'packaged-startup-proof.json'),'utf8'));
 if(proof.schema_version!==1||proof.platform!=='win32'||proof.version!==version||proof.isPackaged!==true||proof.dependenciesLoaded!==true||proof.bridgeStarted!==false||proof.rendererStarted!==false)throw Error('Missing or invalid packaged Windows startup evidence');
 const installer=fs.readFileSync(path.join(directory,'Mangiamo-Desktop-Setup.exe'));
 const hash=crypto.createHash('sha512').update(installer).digest('base64');
 if(proof.installer_size!==installer.length||proof.installer_sha512!==hash)throw Error('Installer differs from the startup-verified artifact');
 const manifest=fs.readFileSync(path.join(directory,'latest.yml'),'utf8');
 if(manifest.match(/^version:\s*(\S+)/m)?.[1]!==version||manifest.match(/^sha512:\s*(\S+)/m)?.[1]!==hash)throw Error('Update manifest does not match the verified installer');
 console.log('[release-gate] Startup evidence, installer and update manifest match '+version);
}
module.exports={verifyRelease};
if(require.main===module)verifyRelease(path.resolve(process.argv[2]||'dist-desktop'),(process.argv[3]||require('../../package.json').version).replace(/^v/,''));
