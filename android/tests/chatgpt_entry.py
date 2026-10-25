"""Run the actual native handoff methods against small JVM Android API doubles.
No Android device or OAuth server is involved. JDK 17 is required.
"""
from pathlib import Path
import os,subprocess,tempfile
root=Path(__file__).resolve().parents[1]
src=(root/'app/src/main/java/com/seosol/ebookviewer/recent/MainActivity.java').read_text(encoding='utf-8-sig')
a=src.index('    private String pendingSelection;');b=src.index('    @Override public void onCreate',a)
methods=src[a:b]
jdk=Path(os.environ.get('JAVA_HOME','C:/Program Files/Android/Android Studio/jbr'))
javac=str(jdk/'bin/javac.exe') if (jdk/'bin/javac.exe').exists() else str(jdk/'bin/javac') if (jdk/'bin/javac').exists() else 'javac'
java=str(jdk/'bin/java.exe') if (jdk/'bin/java.exe').exists() else str(jdk/'bin/java') if (jdk/'bin/java').exists() else 'java'
fixture=r"""
import java.util.*;
class Activity {
 static final int RESULT_CANCELED=0; int finished,result=-1;Intent intent;
 protected void onNewIntent(Intent i){} void setIntent(Intent i){intent=i;}
 void runOnUiThread(Runnable r){r.run();} void finish(){finished++;}void setResult(int x){result=x;}
}
@interface JavascriptInterface {}
class Uri {
 java.net.URI uri;Uri(String s){uri=java.net.URI.create(s);}
 String getScheme(){return uri.getScheme();}String getHost(){return uri.getHost();}
 String getPath(){return uri.getPath();}String getQuery(){return uri.getQuery();}String getFragment(){return uri.getFragment();}
}
class Intent {
 static final String ACTION_PROCESS_TEXT="android.intent.action.PROCESS_TEXT",ACTION_VIEW="android.intent.action.VIEW",EXTRA_PROCESS_TEXT="text";
 String action,type;Uri data;CharSequence text;
 Intent(String action,String type,CharSequence text,String uri){this.action=action;this.type=type;this.text=text;data=uri==null?null:new Uri(uri);}
 String getAction(){return action;}String getType(){return type;}Uri getData(){return data;}CharSequence getCharSequenceExtra(String k){return text;}
}
class Toast {static final int LENGTH_LONG=1;static Toast makeText(Object c,String s,int n){return new Toast();}void show(){}}
class Web {List<String> calls=new ArrayList<>();void evaluateJavascript(String js,Object callback){calls.add(js);}}
class JSONObject {
 static String quote(String s){return "\""+s.replace("\\","\\\\").replace("\"","\\\"").replace("\n","\\n")+"\"";}
}
class MainActivity extends Activity {
 Web web=new Web();
__METHODS__
 static int checks=0;static void check(boolean b,String name){if(!b)throw new AssertionError(name);checks++;}
 static Intent text(CharSequence s){return new Intent(Intent.ACTION_PROCESS_TEXT,"text/plain",s,null);}
 static Intent settings(String uri){return new Intent(Intent.ACTION_VIEW,null,null,uri);}
 public static void main(String[] args){
  MainActivity a=new MainActivity();a.receiveSelection(text(new StringBuilder("  selected  ")));a.openPendingSelection();check(a.web.calls.size()==0,"cold launch waits for page");check(a.pendingSelection.equals("selected"),"CharSequence captured and trimmed");a.documentReady=true;a.openPendingSelection();check(a.web.calls.size()==1,"dispatch once after load");check(a.web.calls.get(0).contains("readerOpenExternalChatGPT(\"selected\",false)"),"selected text route");a.openPendingSelection();check(a.web.calls.size()==1,"pending cleared");
  a.receiveSelection(settings("ebookviewer://chatgpt/settings"));a.openPendingSelection();check(a.web.calls.get(1).contains("readerOpenExternalChatGPT(\"\",true)"),"settings-only route");a.receiveSelection(text("next"));a.openPendingSelection();check(a.web.calls.get(2).contains("\"next\",false"),"settings flag reset");
  for(String uri:new String[]{"https://chatgpt/settings","ebookviewer://other/settings","ebookviewer://chatgpt/other","ebookviewer://chatgpt/settings?text=bad","ebookviewer://chatgpt/settings#bad"}){MainActivity b=new MainActivity();b.receiveSelection(settings(uri));check(b.pendingSelection==null&&!b.externalSelection,"reject foreign URI "+uri);}
  for(Intent bad:new Intent[]{null,new Intent("other","text/plain","bad",null),new Intent(Intent.ACTION_PROCESS_TEXT,"text/html","bad",null),text(null),text("  "),text("x".repeat(32001))}){MainActivity b=new MainActivity();b.receiveSelection(bad);check(b.pendingSelection==null&&!b.externalSelection,"reject invalid payload");}
  MainActivity b=new MainActivity();b.documentReady=true;Intent i=text("\"); window.bad=true; //\n\u2028");b.onNewIntent(i);check(b.intent==i&&b.web.calls.size()==1,"warm launch captures new intent");check(b.web.calls.get(0).contains("\\\""),"quotes encoded as data");
  b.new SelectionBridge().close();check(b.finished==1&&b.result==0,"close finishes native activity");b.new SelectionBridge().close();check(b.finished==1,"close handled once");
  MainActivity c=new MainActivity();c.new SelectionBridge().close();check(c.finished==0,"ordinary reader does not close");
  System.out.println(checks+" native cold/warm entry, settings URI, payload validation and browser return checks passed.");
 }
}
"""
# The fixture is a raw template, not a second implementation of the handler.
fixture=fixture.replace('__METHODS__',methods)
with tempfile.TemporaryDirectory(prefix='reader-entry-') as tmp:
 p=Path(tmp);(p/'MainActivity.java').write_text(fixture,encoding='utf-8')
 subprocess.run([javac,'-encoding','UTF-8','-d',str(p),str(p/'MainActivity.java')],check=True)
 subprocess.run([java,'-cp',str(p),'MainActivity'],check=True)
