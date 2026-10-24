package com.seosol.ebookviewer.recent;
import android.content.Context;
import android.view.ActionMode;
import android.view.Menu;
import android.view.MenuItem;
import android.webkit.WebView;
/** Add the reader command to Android's native text selection toolbar. */
public final class ReaderWebView extends WebView {
    private static final int CHATGPT=0x53530001;
    public ReaderWebView(Context context){super(context);}
    private ActionMode.Callback wrap(ActionMode.Callback original){return new ActionMode.Callback(){
        private void add(Menu menu){if(menu.findItem(CHATGPT)==null)menu.add(Menu.NONE,CHATGPT,100,"ChatGPT연결").setShowAsAction(MenuItem.SHOW_AS_ACTION_IF_ROOM);}
        @Override public boolean onCreateActionMode(ActionMode mode,Menu menu){boolean created=original.onCreateActionMode(mode,menu);if(created)add(menu);return created;}
        @Override public boolean onPrepareActionMode(ActionMode mode,Menu menu){boolean changed=original.onPrepareActionMode(mode,menu);add(menu);return changed;}
        @Override public boolean onActionItemClicked(ActionMode mode,MenuItem item){if(item.getItemId()==CHATGPT){evaluateJavascript("window.readerOpenSelectedChatGPT && window.readerOpenSelectedChatGPT()",result->mode.finish());return true;}return original.onActionItemClicked(mode,item);}
        @Override public void onDestroyActionMode(ActionMode mode){original.onDestroyActionMode(mode);}
    };}
    @Override public ActionMode startActionMode(ActionMode.Callback callback){return super.startActionMode(wrap(callback));}
    @Override public ActionMode startActionMode(ActionMode.Callback callback,int type){return super.startActionMode(wrap(callback),type);}
}
