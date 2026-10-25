#!/usr/bin/env python3
"""Build the separately installable Android text-selection bridge (JDK 17, SDK 36)."""
import argparse, os, pathlib, shutil, subprocess, tempfile, zipfile
P=pathlib.Path
android=P(__file__).resolve().parents[1]
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--sdk',default=os.environ.get('ANDROID_HOME') or os.environ.get('ANDROID_SDK_ROOT'))
p.add_argument('--jdk',default=os.environ.get('JAVA_HOME'))
p.add_argument('--keystore',required=True,help='Signing keystore; created when absent. Keep it for future updates.')
p.add_argument('--output',default=str(android.parent/'downloads/ChatGPT_Menu_Bridge_v1.0.apk'))
a=p.parse_args()
if not a.sdk or not a.jdk:p.error('--sdk and --jdk (or ANDROID_HOME and JAVA_HOME) are required')
sdk,jdk,key,out=map(lambda s:P(s).resolve(),[a.sdk,a.jdk,a.keystore,a.output])
bt=sdk/'build-tools/36.0.0'
if not bt.exists() and (sdk/'android-16/aapt2').exists():bt=sdk/'android-16' # SDK archive layout
jar=sdk/'platforms/android-36/android.jar'
if not jar.exists():jar=sdk/'android-36/android.jar'
def run(tool,*args):
 tool=P(tool)
 if os.name=='nt':
  for suffix in ['.exe','.bat','']:
   if P(str(tool)+suffix).exists():tool=P(str(tool)+suffix);break
 subprocess.run([str(tool),*map(str,args)],check=True)
password=os.environ.get('MENU_KEY_PASSWORD','android')
key.parent.mkdir(parents=True,exist_ok=True);out.parent.mkdir(parents=True,exist_ok=True)
if not key.exists():run(jdk/'bin/keytool','-genkeypair','-keystore',key,'-alias','chatgptmenu','-keyalg','RSA','-keysize','3072','-validity','10000','-storepass',password,'-keypass',password,'-dname','CN=Ebook Viewer ChatGPT Menu')
with tempfile.TemporaryDirectory(prefix='reader-menu-') as tmp:
 t=P(tmp);classes=t/'classes';classes.mkdir();dex=t/'dex';dex.mkdir()
 run(jdk/'bin/javac','--release','17','-encoding','UTF-8','-classpath',jar,'-d',classes,*sorted((android/'app/src/main/java').rglob('*.java')))
 with zipfile.ZipFile(t/'classes.jar','w') as z:
  for c in sorted(classes.rglob('*.class')):z.write(c,c.relative_to(classes))
 run(bt/'d8','--min-api','23','--lib',jar,'--output',dex,t/'classes.jar')
 run(bt/'aapt2','compile','--dir',android/'app/src/main/res','-o',t/'res.zip')
 run(bt/'aapt2','link','-o',t/'unsigned.apk','--manifest',android/'menu-bridge/AndroidManifest.xml','-I',jar,'--min-sdk-version','23','--target-sdk-version','36','--version-code','1','--version-name','1.0',t/'res.zip','-A',android/'app/src/main/assets')
 with zipfile.ZipFile(t/'unsigned.apk','a') as z:z.write(dex/'classes.dex','classes.dex')
 run(bt/'zipalign','-f','-P','16','4',t/'unsigned.apk',t/'aligned.apk')
 run(bt/'apksigner','sign','--ks',key,'--ks-key-alias','chatgptmenu','--ks-pass','pass:'+password,'--key-pass','pass:'+password,'--out',out,t/'aligned.apk')
 run(bt/'apksigner','verify','--verbose',out)
 run(bt/'zipalign','-c','-P','16','4',out)
print(out)
