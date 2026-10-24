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
    public ReaderWebView(Context context){super(context);}
    public ActionMode.Callback selectionCallback(ActionMode.Callback original){
        return original instanceof SelectionCallback ? original : new SelectionCallback(original);
    }
    private final class SelectionCallback extends ActionMode.Callback2 {
        private final ActionMode.Callback original;
        SelectionCallback(ActionMode.Callback original){this.original=original;}
        private boolean add(Menu menu){
            boolean added=menu.findItem(CHATGPT)==null;
            if(added)menu.add(Menu.NONE,CHATGPT,0,"ChatGPT연결");
            for(int i=0;i<menu.size();i++){
                MenuItem item=menu.getItem(i);
                item.setShowAsAction(item.getItemId()==CHATGPT ? MenuItem.SHOW_AS_ACTION_ALWAYS : MenuItem.SHOW_AS_ACTION_IF_ROOM);
            }
            return added;
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
            if(item.getItemId()!=CHATGPT)return original.onActionItemClicked(mode,item);
            // The callback result is a JSON-encoded string produced by WebView itself.
            // Save it before finish(), which can clear the DOM selection on Android.
            evaluateJavascript("window.readerGPTCaptureSelection ? window.readerGPTCaptureSelection() : ''", selectedJson->{
                if(selectedJson==null||selectedJson.equals("null")||selectedJson.equals("\"\""))return;
                mode.finish();
                postOnAnimation(()->evaluateJavascript("window.readerOpenChatGPT && window.readerOpenChatGPT("+selectedJson+")",null));
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
