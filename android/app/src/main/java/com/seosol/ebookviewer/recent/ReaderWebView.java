package com.seosol.ebookviewer.recent;
import android.content.Context;
import android.graphics.Rect;
import android.view.ActionMode;
import android.view.Menu;
import android.view.MenuItem;
import android.view.View;
import android.webkit.WebView;

/** Keep Chromium's selection geometry and open GPT only after native selection closes. */
public final class ReaderWebView extends WebView {
    private static final int CHATGPT=0x53530001;
    private static final int MARK_READ=0x53530002;
    private static final int INSIGHTS=0x53530003;
    public ReaderWebView(Context context){super(context);}
    public ActionMode.Callback selectionCallback(ActionMode.Callback original){
        return original instanceof SelectionCallback ? original : new SelectionCallback(original);
    }
    private final class SelectionCallback extends ActionMode.Callback2 {
        private final ActionMode.Callback original;
        SelectionCallback(ActionMode.Callback original){this.original=original;}
        private boolean add(Menu menu){
            boolean changed=false;
            if(menu.findItem(CHATGPT)==null){menu.add(Menu.NONE,CHATGPT,0,"ChatGPT연결");changed=true;}
            if(menu.findItem(MARK_READ)==null){menu.add(Menu.NONE,MARK_READ,1,"읽은 지점 지정");changed=true;}
            if(menu.findItem(INSIGHTS)==null){menu.add(Menu.NONE,INSIGHTS,2,"독서정보 보기");changed=true;}
            for(int i=0;i<menu.size();i++){
                MenuItem item=menu.getItem(i);
                item.setShowAsAction(item.getItemId()==CHATGPT ? MenuItem.SHOW_AS_ACTION_ALWAYS : MenuItem.SHOW_AS_ACTION_IF_ROOM);
            }
            return changed;
        }
        @Override public boolean onCreateActionMode(ActionMode mode,Menu menu){
            boolean created=original.onCreateActionMode(mode,menu);if(created)add(menu);return created;
        }
        @Override public boolean onPrepareActionMode(ActionMode mode,Menu menu){
            boolean changed=original.onPrepareActionMode(mode,menu);return add(menu)||changed;
        }
        @Override public void onGetContentRect(ActionMode mode,View view,Rect outRect){
            if(original instanceof ActionMode.Callback2)((ActionMode.Callback2)original).onGetContentRect(mode,view,outRect);
            else super.onGetContentRect(mode,view,outRect);
        }
        @Override public boolean onActionItemClicked(ActionMode mode,MenuItem item){
            int id=item.getItemId();
            if(id!=CHATGPT&&id!=MARK_READ&&id!=INSIGHTS)return original.onActionItemClicked(mode,item);
            if(id==MARK_READ){
                // Read the DOM range while Chromium still owns it; selectToRead validates
                // the selected word's canonical offset and corrects the spoiler gate.
                evaluateJavascript("Boolean(window.readerInsights&&window.readerInsights.selectToRead&&window.readerInsights.selectToRead())", accepted->{
                    if("true".equals(accepted))mode.finish();
                });
                return true;
            }
            // The callback receives JSON quoted by WebView. Capture BEFORE mode.finish(),
            // because closing Android's native selection menu clears the DOM selection.
            evaluateJavascript("window.readerGPTCaptureSelection ? window.readerGPTCaptureSelection() : ''", selectedJson->{
                if(selectedJson==null||selectedJson.equals("null")||selectedJson.equals("\"\""))return;
                mode.finish();
                if(id==CHATGPT){
                    postOnAnimation(()->evaluateJavascript("window.readerOpenChatGPT && window.readerOpenChatGPT("+selectedJson+")",null));
                }else{
                    postOnAnimation(()->evaluateJavascript("window.readerInsights && window.readerInsights.openForSelection && window.readerInsights.openForSelection("+selectedJson+")",null));
                }
            });
            return true;
        }
        @Override public void onDestroyActionMode(ActionMode mode){original.onDestroyActionMode(mode);}
    }
    @Override public ActionMode startActionMode(ActionMode.Callback callback){return super.startActionMode(selectionCallback(callback));}
    @Override public ActionMode startActionMode(ActionMode.Callback callback,int type){return super.startActionMode(selectionCallback(callback),type);}
    @Override public ActionMode startActionModeForChild(View child,ActionMode.Callback callback){return super.startActionModeForChild(child,selectionCallback(callback));}
    @Override public ActionMode startActionModeForChild(View child,ActionMode.Callback callback,int type){return super.startActionModeForChild(child,selectionCallback(callback),type);}
}
