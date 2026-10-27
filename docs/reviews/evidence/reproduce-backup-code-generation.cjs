const fs=require('fs'), ts=require('typescript'), Module=require('module'), path=require('path');
const filename=path.resolve('src/auth/crypto/totp-generator.ts');
const mod=new Module(filename,module); mod.filename=filename; mod.paths=Module._nodeModulePaths(path.dirname(filename));
const original=mod.require.bind(mod);mod.require=id=>id==='../../utils/logger'?{logger:new Proxy({}, {get:()=>()=>{}})}:original(id);
mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,filename);
const generator=mod.exports.secureTOTPGenerator;
if(process.argv[2]==='generate') { generator.generateBackupCodes(1); console.log('returned'); }
else console.log(JSON.stringify({codeLength:generator.getBackupConfig().length,minimumEntropy:generator.getBackupConfig().minEntropy,maxPossibleMeasuredEntropy:8*Math.log2(8),uniqueExampleAccepted:generator.validateBackupCodeEntropy('ABCDEFGH')},null,2));
