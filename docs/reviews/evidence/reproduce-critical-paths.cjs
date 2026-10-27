const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const assert = require('node:assert/strict');
const report = {};
const logger = new Proxy({}, {get: () => () => {}});
const config = {env:'test',jwt:{secret:'x'.repeat(32),accessExpiresIn:'15m',refreshExpiresIn:'7d',issuer:'review',audience:'review'},mfa:{issuer:'Review',window:1}};
function load(rel, overrides = {}) {
  const filename = path.resolve(rel);
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  const originalRequire = mod.require.bind(mod);
  mod.require = id => Object.hasOwn(overrides,id) ? overrides[id] : originalRequire(id);
  const out = ts.transpileModule(fs.readFileSync(filename,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}});
  mod._compile(out.outputText, filename);
  return mod.exports;
}
function memoryRedis(prefix='') {
 const data = new Map();
 const api = {
  data,
  get: async k => data.get(prefix+k) ?? null,
  setex: async (k,t,v) => {data.set(prefix+k,v);return 'OK';},
  del: async k => Number(data.delete(prefix+k)),
  keys: async pattern => [...data.keys()].filter(k=>k.startsWith(pattern.replace('*',''))),
  hgetall: async k => data.get(prefix+k) ?? {},
  hset: async (k,v) => {data.set(prefix+k,v);return 1;},
  exists: async k => Number(data.has(prefix+k)),
  expire: async () => 1,
  pipeline: () => {
    const operations=[];
    const p={exec:async()=>Promise.all(operations.map(async fn=>[null,await fn()]))};
    for (const name of ['setex','del','expire']) p[name]=(...args)=>{operations.push(()=>api[name](...args));return p;};
    p.sadd=()=>p;
    return p;
  }
 };
 return api;
}
(async () => {
 const {MCPSecurityValidator} = load('src/server/mcp-security.ts', {'../utils/logger':{logger}});
 const validator = new MCPSecurityValidator();
 const initialize = version => JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:version,capabilities:{},clientInfo:{name:'review',version:'1.0.0'}}});
 report.protocolDefaultVersion = await validator.validateMessage(initialize('2024-11-05'));
 report.protocolSemver = (await validator.validateMessage(initialize('0.5.0'))).valid;
 assert.equal(report.protocolDefaultVersion.valid,false);
 assert.equal(report.protocolSemver,true);
 const ping=JSON.stringify({jsonrpc:'2.0',id:10,method:'ping'});
 report.sharedReplayCache = {first:(await validator.validateMessage(ping)).valid,second:await validator.validateMessage(ping)};
 report.requestIdZero = validator.validateRequestId(0);
 report.echoMissingRequiredArgument = validator.validateToolExecution('echo',{});
 const {SecurityMiddleware} = load('src/security/middleware.ts', {'../utils/logger':{logger},'../config/config':{config}});
 let delivered;
 const res={json: value=>{delivered=value;return value;}};
 SecurityMiddleware.sanitizeOutput({},res,()=>{});
 res.json({success:true,accessToken:'test-access',refreshToken:'test-refresh',tempToken:'test-temporary',secret:'test-secret',expiresIn:900});
 report.authResponseAfterMiddleware=delivered;
 assert.deepEqual(Object.keys(delivered),['success','expiresIn']);
 const Command = require('ioredis/built/Command').default;
 report.ioredisPrefixHandling={keys:new Command('keys',['active_token:*'],{keyPrefix:'mcp:'}).args,get:new Command('get',['active_token:a'],{keyPrefix:'mcp:'}).args};
 report.revocation=[];
 for (const prefix of ['', 'mcp:']) {
  const redis=memoryRedis(prefix);
  const {JWTService}=load('src/auth/jwt-service.ts',{
   '../utils/logger':{logger},'../config/config':{config},'../database/redis':{redis},'../security/vault':{vault:{}},
   './distributed-lock':{distributedLock:{acquireLock:async()=>({acquired:true}),releaseLock:async()=>{}}},'./token-blacklist':{tokenBlacklist:{initialize:async()=>{},isBlacklisted:async()=>false,addToBlacklist:async()=>{}}},
   './token-rate-limiter':{tokenRateLimiter:{checkValidationLimit:async()=>({allowed:true}),checkGenerationLimit:async()=>({allowed:true}),checkRefreshLimit:async()=>({allowed:true}),isUserBlocked:async()=>false}}
  });
  const svc=new JWTService();
  try {await svc.verifyAccessToken('x');} catch(e){report.uninitializedJWT=e.message;}
  await svc.initialize();
  const pair=await svc.generateTokenPair({userId:'refresh-user',email:'refresh@example.invalid',roles:[],permissions:[],sessionId:'refresh-session',mfaVerified:false});
  try {await svc.refreshAccessToken(pair.refreshToken);report.refreshFirstUse='unexpected success';}catch(e){report.refreshFirstUse=e.message;}
  await redis.setex('active_token:alice',900,JSON.stringify({userId:'alice',sessionId:'alice-session'}));
  await redis.setex('active_token:bob',900,JSON.stringify({userId:'bob',sessionId:'bob-session'}));
  await redis.setex('token_family:alice',900,JSON.stringify({userId:'alice',sessionId:'alice-session'}));
  await svc.revokeSession('alice-session');
  report.revocation.push({prefix,aliceActive:!!await redis.get('active_token:alice'),bobActive:!!await redis.get('active_token:bob'),aliceRefreshFamilyActive:!!await redis.get('token_family:alice')});
 }
 const {secureEncryption}=load('src/auth/crypto/secure-encryption.ts',{'../../utils/logger':{logger}});
 const redis=memoryRedis();
 const {MFAService}=load('src/auth/mfa-service.ts', {
  '../utils/logger':{logger},'../config/config':{config},'../database/redis':{redis},'../security/vault':{vault:{}},
  './crypto/secure-encryption':{secureEncryption},'./crypto/key-derivation':{},'./crypto/integrity-protection':{},
  './crypto/totp-generator':{secureTOTPGenerator:{generateSecret:()=> 'JBSWY3DPEHPK3PXP',validateSecretEntropy:()=>({isValid:true,entropy:80,strength:'review'}),generateOTPURL:()=> 'otpauth://totp/review?secret=JBSWY3DPEHPK3PXP',generateBackupCodes:()=>[],verifyToken:()=>true}}
 });
 const mfa=new MFAService();
 await mfa.initialize();
 const setup=await mfa.generateMFASecret('review-user','review@example.invalid');
 const stored=await redis.hgetall('mfa_setup:review-user');
 const recovered=await secureEncryption.decryptMFASecret(JSON.parse(stored.secret),'review-user:review@example.invalid');
 report.mfaPublicIdentityDecrypts = recovered===setup.secret;
 assert.equal(report.mfaPublicIdentityDecrypts,true);
 try {await mfa.verifyMFASetup('review-user','123456');report.mfaEnrollment='unexpected success';}catch(e){report.mfaEnrollment=e.message;}
 redis.exists=async()=>{throw new Error('Review injected storage failure');};
 report.mfaEnabledOnStorageError=await mfa.isMFAEnabled('review-user');
 console.log(JSON.stringify(report,null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
