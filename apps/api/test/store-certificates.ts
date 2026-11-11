import { execFileSync } from "node:child_process";
import { createPrivateKey,sign,X509Certificate } from "node:crypto";
import { mkdtempSync,readFileSync,writeFileSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join,resolve,sep } from "node:path";
/** Generates ephemeral, synthetic signing material. No PEM/private key is committed, logged or retained. */
export function testCertificates(){
  const dir=mkdtempSync(join(tmpdir(),"dandelist-store-cert-"));
  const openssl=process.platform==="win32"?"C:/Program Files/Git/usr/bin/openssl.exe":"openssl";
  const run=(...args:string[])=>execFileSync(openssl,args,{cwd:dir,stdio:"ignore",windowsHide:true});
  try{
    for(const name of ["root","intermediate","leaf"])run("genpkey","-algorithm","EC","-pkeyopt","ec_paramgen_curve:P-256","-out",name+".key");
    run("req","-new","-x509","-key","root.key","-sha256","-days","2","-subj","/CN=Dandelist synthetic test root","-addext","basicConstraints=critical,CA:TRUE","-out","root.pem");
    writeFileSync(join(dir,"intermediate.ext"),"basicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\n1.2.840.113635.100.6.2.1=DER:05:00\n");
    writeFileSync(join(dir,"leaf.ext"),"basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\n1.2.840.113635.100.6.11.1=DER:05:00\n");
    for(const [name,issuer]of [["intermediate","root"],["leaf","intermediate"]]){
      run("req","-new","-key",name+".key","-subj","/CN=Dandelist synthetic "+name,"-out",name+".csr");
      run("x509","-req","-in",name+".csr","-CA",issuer+".pem","-CAkey",issuer+".key","-set_serial",name==="leaf"?"3":"2","-days","2","-sha256","-extfile",name+".ext","-out",name+".pem");
    }
    const certs=["leaf","intermediate","root"].map(n=>new X509Certificate(readFileSync(join(dir,n+".pem"))).raw);
    const key=createPrivateKey(readFileSync(join(dir,"leaf.key")));
    return {root:certs[2]!,jws(payload:unknown,header:Record<string,unknown>={}){
      const data=Buffer.from(JSON.stringify({alg:"ES256",x5c:certs.map(c=>c.toString("base64")),...header})).toString("base64url")+"."+Buffer.from(JSON.stringify(payload)).toString("base64url");
      return data+"."+sign("sha256",Buffer.from(data),{key,dsaEncoding:"ieee-p1363"}).toString("base64url");
    }};
  }finally{
    if(!resolve(dir).startsWith(resolve(tmpdir())+sep))throw new Error("Unexpected certificate temp directory");
    rmSync(dir,{recursive:true,force:true});
  }
}
