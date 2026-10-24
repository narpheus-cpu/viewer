from pathlib import Path
import subprocess,json,tempfile,os,shutil
root=Path(tempfile.mkdtemp(prefix='viewer-selection-test-'));src=root/'src';out=root/'classes';out.mkdir(parents=True,exist_ok=True)
stubs={
'android/content/Context.java':'package android.content; public class Context {}',
'android/graphics/Rect.java':'package android.graphics; public class Rect {public int left,top,right,bottom;public void set(int l,int t,int r,int b){left=l;top=t;right=r;bottom=b;}}',
'android/view/View.java':'package android.view; public class View {}',
'android/view/MenuItem.java':'package android.view; public interface MenuItem {int SHOW_AS_ACTION_ALWAYS=2,SHOW_AS_ACTION_IF_ROOM=1; int getItemId();void setShowAsAction(int value);}',
'android/view/Menu.java':'package android.view; public interface Menu {int NONE=0;MenuItem findItem(int id);MenuItem add(int group,int id,int order,CharSequence title);int size();MenuItem getItem(int index);}',
'android/view/ActionMode.java':'package android.view; import android.graphics.Rect; public abstract class ActionMode {public abstract void finish();public interface Callback {boolean onCreateActionMode(ActionMode m,Menu menu);boolean onPrepareActionMode(ActionMode m,Menu menu);boolean onActionItemClicked(ActionMode m,MenuItem item);void onDestroyActionMode(ActionMode m);} public abstract static class Callback2 implements Callback {public void onGetContentRect(ActionMode m,View v,Rect r){r.set(0,0,1000,1000);}}}',
'android/webkit/ValueCallback.java':'package android.webkit; public interface ValueCallback<T> {void onReceiveValue(T value);}',
'android/webkit/WebView.java':'''package android.webkit;
import android.content.Context;import android.view.*;import java.util.*;
public class WebView extends View {public ActionMode.Callback lastCallback;public String selection="\\\"선택한 문장\\\"";public List<String> events=new ArrayList<>(),scripts=new ArrayList<>();public List<Runnable> frames=new ArrayList<>();public WebView(Context c){}
public void evaluateJavascript(String script,ValueCallback<String> callback){scripts.add(script);if(callback!=null){events.add("capture");callback.onReceiveValue(selection);}else events.add("popup");}
public void postOnAnimation(Runnable r){frames.add(r);}public ActionMode startActionMode(ActionMode.Callback c){lastCallback=c;return null;}public ActionMode startActionMode(ActionMode.Callback c,int type){lastCallback=c;return null;}public ActionMode startActionModeForChild(View child,ActionMode.Callback c){lastCallback=c;return null;}public ActionMode startActionModeForChild(View child,ActionMode.Callback c,int type){lastCallback=c;return null;}}
''',
'NativeSelectionTest.java':'''import android.content.Context;import android.graphics.Rect;import android.view.*;import com.seosol.ebookviewer.recent.ReaderWebView;import java.util.*;
public class NativeSelectionTest {
static int checks=0;static void check(boolean value){if(!value)throw new AssertionError("check "+checks);checks++;}
static class Item implements MenuItem {int id,display,order;String title;Item(int id,int order,String title){this.id=id;this.order=order;this.title=title;}public int getItemId(){return id;}public void setShowAsAction(int d){display=d;}}
static class Items implements Menu {List<Item> items=new ArrayList<>();public MenuItem findItem(int id){return items.stream().filter(i->i.id==id).findFirst().orElse(null);}public MenuItem add(int g,int id,int order,CharSequence title){Item i=new Item(id,order,title.toString());items.add(i);return i;}public int size(){return items.size();}public MenuItem getItem(int i){return items.get(i);}}
static class Original extends ActionMode.Callback2 {int copies=0,destroys=0;public boolean onCreateActionMode(ActionMode m,Menu menu){menu.add(0,1,1,"복사");return true;}public boolean onPrepareActionMode(ActionMode m,Menu menu){((Items)menu).items.removeIf(i->i.id!=1);return false;}public boolean onActionItemClicked(ActionMode m,MenuItem item){copies++;return true;}public void onDestroyActionMode(ActionMode m){destroys++;}public void onGetContentRect(ActionMode m,View v,Rect r){r.set(20,30,140,60);}}
public static void main(String[] args){ReaderWebView web=new ReaderWebView(new Context());Original original=new Original();ActionMode.Callback callback=web.selectionCallback(original);check(callback instanceof ActionMode.Callback2);check(web.selectionCallback(callback)==callback);
ActionMode mode=new ActionMode(){public void finish(){web.events.add("finish");web.selection="\\\"\\\"";callback.onDestroyActionMode(this);}};Items menu=new Items();check(callback.onCreateActionMode(mode,menu));Item gpt=(Item)menu.findItem(0x53530001);check(gpt!=null);check(gpt.display==MenuItem.SHOW_AS_ACTION_ALWAYS);check(gpt.order==0);check(menu.findItem(1)!=null);check(((Item)menu.findItem(1)).display==MenuItem.SHOW_AS_ACTION_IF_ROOM);
Rect rect=new Rect();((ActionMode.Callback2)callback).onGetContentRect(mode,web,rect);check(rect.left==20&&rect.top==30&&rect.right==140&&rect.bottom==60);
check(callback.onPrepareActionMode(mode,menu));gpt=(Item)menu.findItem(0x53530001);check(gpt!=null);check(callback.onActionItemClicked(mode,menu.findItem(1)));check(original.copies==1&&web.events.isEmpty());
String selected=web.selection;check(callback.onActionItemClicked(mode,gpt));check(web.events.equals(Arrays.asList("capture","finish")));check(original.destroys==1);check(web.frames.size()==1);web.frames.remove(0).run();check(web.events.equals(Arrays.asList("capture","finish","popup")));check(web.scripts.get(web.scripts.size()-1).contains("readerOpenChatGPT("+selected+")"));
web.events.clear();web.scripts.clear();check(callback.onActionItemClicked(mode,gpt));check(web.events.equals(Arrays.asList("capture")));check(web.frames.isEmpty());
web.startActionMode(original);check(web.lastCallback instanceof ActionMode.Callback2);web.startActionMode(original,1);check(web.lastCallback instanceof ActionMode.Callback2);web.startActionModeForChild(web,original);check(web.lastCallback instanceof ActionMode.Callback2);web.startActionModeForChild(web,original,1);check(web.lastCallback instanceof ActionMode.Callback2);
System.out.println(checks+" native menu, geometry, callback routing, copy, recreation and selection handoff checks passed.");}
}
'''
}
for name,content in stubs.items():
 p=src/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(content,encoding='utf-8',newline='\n')
reader=Path(__file__).resolve().parents[1]/'app/src/main/java/com/seosol/ebookviewer/recent/ReaderWebView.java'
java=Path(os.environ.get('JAVA_HOME','C:/Program Files/Android/Android Studio/jbr'))/'bin'
ext='.exe' if os.name=='nt' else ''
subprocess.run([str(java/('javac'+ext)),'--release','17','-encoding','UTF-8','-d',str(out),*map(str,src.rglob('*.java')),str(reader)],check=True)
subprocess.run([str(java/('java'+ext)),'-cp',str(out),'NativeSelectionTest'],check=True)
