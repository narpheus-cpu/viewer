"""Execute the actual MainActivity asset handler with JVM Android API doubles."""
from pathlib import Path
import os,subprocess,tempfile
root=Path(__file__).resolve().parents[1]
src=(root/'app/src/main/java/com/seosol/ebookviewer/recent/MainActivity.java').read_text(encoding='utf-8')
a=src.index('    private static boolean isReaderAssetPath(');b=src.index('    public final class PositionBridge',a);methods=src[a:b]
jdk=Path(os.environ.get('JAVA_HOME','C:/Program Files/Android/Android Studio/jbr'))
def executable(name):
 p=jdk/'bin'/(name+'.exe');return str(p if p.exists() else jdk/'bin'/name)
fixture=r'''
import java.io.*;import java.nio.file.*;import java.util.*;
class Uri {
 final java.net.URI value;Uri(String s){value=java.net.URI.create(s);}
 String getScheme(){return value.getScheme();}String getHost(){return value.getHost();}
 int getPort(){return value.getPort();}String getPath(){return value.getPath();}
 public String toString(){return value.toString();}
}
class WebResourceResponse {
 final String mime,encoding;final int status;final InputStream data;
 WebResourceResponse(String m,String e,int s,String r,Map<String,String> h,InputStream d){mime=m;encoding=e;status=s;data=d;}
 WebResourceResponse(String m,String e,InputStream d){this(m,e,200,"OK",new HashMap<>(),d);}
}
class Log {static int e(String t,String s,Throwable e){return 0;}}
class Assets {final Path root;Assets(Path p){root=p;}InputStream open(String name)throws IOException{return Files.newInputStream(root.resolve(name));}}
class Resolver {String getType(Uri u){return "text/plain";}InputStream openInputStream(Uri u)throws IOException{throw new IOException("No grant");}}
public class AssetProbe {
 final Assets assets;final Set<String> selectedFiles=new HashSet<>();static int checks;
 AssetProbe(Path root){assets=new Assets(root);}Assets getAssets(){return assets;}Resolver getContentResolver(){return new Resolver();}
 static void check(boolean value,String description){if(!value)throw new AssertionError(description);checks++;}
 METHODS
 public static void main(String[] args)throws Exception{
  Path root=Path.of(args[0]);AssetProbe probe=new AssetProbe(root);
  try(var files=Files.walk(root)){for(Path p:files.filter(Files::isRegularFile).toList()){
   String name=root.relativize(p).toString().replace('\\','/');WebResourceResponse response=probe.serve(new Uri("https://appassets.androidplatform.net/assets/"+name));
   check(response.status==200,"Asset blocked: "+name);check(response.mime.equals(name.endsWith(".json")?"application/json":name.endsWith(".js")?"application/javascript":"text/html"),"MIME: "+name);
   check(Arrays.equals(response.data.readAllBytes(),Files.readAllBytes(p)),"Asset bytes: "+name);response.data.close();
  }}
  for(String url:List.of("https://example.com/assets/timelines/default/index.json","http://appassets.androidplatform.net/assets/timelines/default/index.json","https://appassets.androidplatform.net:444/assets/timelines/default/index.json","https://appassets.androidplatform.net/assets/other.json","https://appassets.androidplatform.net/assets/timelines/default/../index.json","https://appassets.androidplatform.net/assets/timelines/default/%2e%2e/index.json","https://appassets.androidplatform.net/assets/timelines/default/part-000.json/extra","https://appassets.androidplatform.net/assets/timelines/default/part-000.json%2f..%2findex.html","https://appassets.androidplatform.net/assets/timelines/default/part-999.json","https://appassets.androidplatform.net/assets/timelines/default/secret.json","file:///assets/timelines/default/index.json","content://ungranted/test","https://appassets.androidplatform.net/"))check(probe.serve(new Uri(url)).status==403,"Unexpected allowed path: "+url);
  check(probe.serve(new Uri("https://appassets.androidplatform.net/assets/timelines/default/index.json?x=1")).status==200,"Same local resource query");
  System.out.println(checks+" actual native asset status, JSON MIME, exact data and denied-path checks passed.");
 }
}
'''.replace('METHODS',methods)
folder=Path(__file__).resolve().parent/'asset-test-temp';folder.mkdir(exist_ok=True)
with tempfile.TemporaryDirectory(dir=folder) as temp:
 p=Path(temp);(p/'AssetProbe.java').write_text(fixture,encoding='utf-8')
 subprocess.run([executable('javac'),'--release','17','-encoding','UTF-8','-d',str(p),str(p/'AssetProbe.java')],check=True)
 subprocess.run([executable('java'),'-cp',str(p),'AssetProbe',str(root/'app/src/main/assets')],check=True)
