import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  CheckCircle2, Circle, Clock, Plus, Trash2, Edit2, 
  Paperclip, FolderOpen, AlertCircle, X, 
  Eye, EyeOff, GripVertical, GripHorizontal, Tags, Send, AlignLeft, Calendar, Filter, Check, History, Undo2,
  Folder, FileText, ChevronRight, ChevronDown, ChevronUp, ArrowLeft,
  Mic, MicOff, Image as ImageIcon, Palette, Eraser, PenTool, Move, WifiOff, Loader2, Cloud, ExternalLink, Link as LinkIcon, LogOut, ShieldAlert
} from 'lucide-react';

// ==========================================
// 1. Google Drive API 金鑰設定
// ==========================================
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const GOOGLE_API_KEY = import.meta.env.VITE_GOOGLE_API_KEY;

// ==========================================
// 2. 個人 Firebase 初始化
// ==========================================
import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { getFirestore, collection, onSnapshot, doc, getDoc, setDoc, deleteDoc, updateDoc, deleteField, enableIndexedDbPersistence } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = "my-personal-notebook";

// ==========================================
// 共用元件
// ==========================================
const Toast = ({ message, type = 'info', onClose }) => {
  if (!message) return null;
  const bgColor = type === 'error' ? 'bg-red-500' : 'bg-gray-800';
  return (
    <div className={"fixed bottom-4 right-4 text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 z-[150] animate-bounce-short " + bgColor}>
      {type === 'error' ? <AlertCircle size={20} /> : <CheckCircle2 size={20} />}
      <span>{message}</span>
      <button onClick={onClose} className="hover:text-gray-300 ml-2"><X size={16} /></button>
    </div>
  );
};

const ConfirmModal = ({ isOpen, title, message, onConfirm, onCancel }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-gray-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-[150]">
      <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 animate-scale-up">
        <div className="flex items-center gap-3 text-red-600 mb-4"><AlertCircle size={24} /><h3 className="text-lg font-bold">{title}</h3></div>
        <p className="text-gray-600 mb-6">{message}</p>
        <div className="flex justify-end gap-3">
          <button onClick={onCancel} className="px-4 py-2 text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors font-medium">取消</button>
          <button onClick={onConfirm} className="px-4 py-2 text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors font-medium">確定執行</button>
        </div>
      </div>
    </div>
  );
};

// 🚀 核心 Hook: Google Picker
function useGooglePicker(clientId, apiKey) {
  const [isReady, setIsReady] = useState(false);
  const tokenClientRef = useRef(null);

  useEffect(() => {
    if (!clientId || !apiKey || clientId.includes("請在此填入")) return;

    let gapiLoaded = false;
    let gisLoaded = false;
    const checkReady = () => { if (gapiLoaded && gisLoaded) setIsReady(true); };

    const gapiScript = document.createElement('script');
    gapiScript.src = 'https://apis.google.com/js/api.js';
    gapiScript.async = true;
    gapiScript.onload = () => { window.gapi.load('picker', { callback: () => { gapiLoaded = true; checkReady(); } }); };
    document.body.appendChild(gapiScript);

    const gisScript = document.createElement('script');
    gisScript.src = 'https://accounts.google.com/gsi/client';
    gisScript.async = true;
    gisScript.onload = () => {
      tokenClientRef.current = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: 'https://www.googleapis.com/auth/drive.file',
        callback: '' 
      });
      gisLoaded = true; checkReady();
    };
    document.body.appendChild(gisScript);

    return () => { document.body.removeChild(gapiScript); document.body.removeChild(gisScript); }
  }, [clientId, apiKey]);

  const openPicker = (onSuccess, onError) => {
    if (!isReady) { onError("Google Drive API 尚未準備好，請確認金鑰設定並稍候。"); return; }
    tokenClientRef.current.callback = async (response) => {
      if (response.error) { onError(response.error); return; }
      const uploadView = new window.google.picker.DocsUploadView();
      const docsView = new window.google.picker.DocsView().setIncludeFolders(true);
      const picker = new window.google.picker.PickerBuilder()
        .addView(uploadView)
        .addView(docsView)
        .setOAuthToken(response.access_token)
        .setDeveloperKey(apiKey)
        .setCallback((data) => { if (data.action === window.google.picker.Action.PICKED) onSuccess(data.docs[0]); })
        .build();
      picker.setVisible(true);
    };
    tokenClientRef.current.requestAccessToken({ prompt: '' });
  };

  return { isReady, openPicker };
}

// ==========================================
// 主程式元件 (App)
// ==========================================
export default function App() {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true); 
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [toastMsg, setToastMsg] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState({ isOpen: false, title: '', message: '', onConfirm: null });
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  
  const [todos, setTodos] = useState([]);
  const [categories, setCategories] = useState([]); 
  const [folders, setFolders] = useState([]);
  const [notes, setNotes] = useState([]);
  
  const [mainModule, setMainModule] = useState('tasks');
  const [taskViewMode, setTaskViewMode] = useState('board');
  const [colsVisible, setColsVisible] = useState({ urgent: true, semi: true, normal: true });
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [activeTodoDetail, setActiveTodoDetail] = useState(null);
  const [isCreateTodoModalOpen, setIsCreateTodoModalOpen] = useState(false);
  const [filterCategory, setFilterCategory] = useState('');
  const [currentFolderId, setCurrentFolderId] = useState(null);
  const [isCreateFolderModalOpen, setIsCreateFolderModalOpen] = useState(false);
  const [activeNoteDetail, setActiveNoteDetail] = useState(null);
  const [movingNoteId, setMovingNoteId] = useState(null);

  useEffect(() => {
    enableIndexedDbPersistence(db).catch((err) => console.warn("離線快取狀態:", err));
    const handleOnline = () => { setIsOnline(true); showToast("網路已恢復，資料自動同步中"); };
    const handleOffline = () => { setIsOnline(false); showToast("⚡ 已進入離線模式，變更將保存在本地", "error"); };
    window.addEventListener('online', handleOnline); window.addEventListener('offline', handleOffline);
    return () => { window.removeEventListener('online', handleOnline); window.removeEventListener('offline', handleOffline); };
  }, []);

  // 🔐 監聽認證狀態 + Firestore 白名單驗證
  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        try {
          const whitelistRef = doc(db, 'whitelist', currentUser.email);
          const whitelistSnap = await getDoc(whitelistRef);

          if (whitelistSnap.exists()) {
            setUser(currentUser);
          } else {
            await signOut(auth);
            setUser(null);
            showToast("無存取權限。您的帳號不在資料庫授權名單中。", "error");
          }
        } catch (error) {
          console.error("驗證白名單發生錯誤:", error);
          await signOut(auth);
          setUser(null);
          showToast("白名單驗證失敗，請確認 Firestore 規則是否正確設定。", "error");
        }
      } else {
        setUser(null);
      }
      setIsLoading(false);
    });
    return () => unsubscribeAuth();
  }, []);

  const handleGoogleLogin = async () => {
    setIsLoggingIn(true);
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      if (error.code !== 'auth/popup-closed-by-user') {
        showToast("登入失敗: " + error.message, "error");
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = () => {
    reqConfirm("登出系統", "確定要登出並清除目前的快取畫面嗎？", async () => {
      await signOut(auth);
      showToast("您已安全登出");
    });
  };

  useEffect(() => {
    if (!user) return;
    
    const unsubTodos = onSnapshot(collection(db, 'artifacts', appId, 'users', user.uid, 'todos'), (snap) => {
      const fetched = []; snap.forEach(doc => fetched.push({ id: doc.id, ...doc.data() })); setTodos(fetched); 
      setActiveTodoDetail(prev => prev ? fetched.find(t => t.id === prev.id) || null : null);
    });
    const unsubCat = onSnapshot(collection(db, 'artifacts', appId, 'users', user.uid, 'categories'), (snap) => {
      const fetched = []; snap.forEach(doc => fetched.push({ id: doc.id, ...doc.data() })); setCategories(fetched);
    });
    const unsubFolders = onSnapshot(collection(db, 'artifacts', appId, 'users', user.uid, 'folders'), (snap) => {
      const fetched = []; snap.forEach(doc => fetched.push({ id: doc.id, ...doc.data() })); setFolders(fetched);
    });
    const unsubNotes = onSnapshot(collection(db, 'artifacts', appId, 'users', user.uid, 'notes'), (snap) => {
      const fetched = []; snap.forEach(doc => fetched.push({ id: doc.id, ...doc.data() })); setNotes(fetched);
      setActiveNoteDetail(prev => prev ? fetched.find(n => n.id === prev.id) || null : null);
    });
    return () => { unsubTodos(); unsubCat(); unsubFolders(); unsubNotes(); };
  }, [user]);

  const showToast = (message, type = 'info') => { setToastMsg({ message, type }); setTimeout(() => setToastMsg(null), 3000); };
  const reqConfirm = (title, message, onConfirm) => { setConfirmDialog({ isOpen: true, title, message, onConfirm: () => { onConfirm(); setConfirmDialog({ isOpen: false }); } }); };

  const buildFolderOptions = (parentId, level = 0) => {
    let options = []; const children = folders.filter(f => f.parentId === parentId);
    for (const child of children) {
      options.push({ id: child.id, name: '　'.repeat(level) + '└ ' + child.name });
      options = options.concat(buildFolderOptions(child.id, level + 1));
    }
    return options;
  };

  const createFolder = async (name, parentId) => {
    try { await setDoc(doc(collection(db, 'artifacts', appId, 'users', user.uid, 'folders')), { name, parentId, createdAt: Date.now() }); showToast("資料夾已建立"); setIsCreateFolderModalOpen(false); } catch (err) {}
  };
  
  const handleDeleteFolder = (folderId) => {
    const hasSubFolders = folders.some(f => f.parentId === folderId); const hasNotes = notes.some(n => n.folderId === folderId);
    if (hasSubFolders || hasNotes) { showToast("無法刪除！請先清空該資料夾。", "error"); return; }
    reqConfirm("刪除資料夾", "確定要刪除這個資料夾嗎？無法復原。", async () => { try { await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'folders', folderId)); showToast("資料夾已刪除"); } catch (err) {} });
  };

  const createNote = async (type) => {
    try {
      const docRef = doc(collection(db, 'artifacts', appId, 'users', user.uid, 'notes'));
      const payload = { title: '未命名筆記', folderId: currentFolderId, type: type, content: '', attachments: [], canvases: [], createdAt: Date.now(), updatedAt: Date.now() };
      await setDoc(docRef, payload); setActiveNoteDetail({ id: docRef.id, ...payload });
    } catch (err) {}
  };

  const handleMoveNote = async (noteId, targetFolderId) => {
    try { await updateDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'notes', noteId), { folderId: targetFolderId, updatedAt: Date.now() }); showToast("筆記已搬移！"); setMovingNoteId(null); } catch (err) {}
  };

  const handleDropNoteToFolder = async (e, targetFolderId) => {
    e.preventDefault(); e.currentTarget.classList.remove('bg-indigo-50', 'border-indigo-400');
    const type = e.dataTransfer.getData('type'); if (type !== 'note') return; 
    const noteId = e.dataTransfer.getData('noteId'); if (!noteId) return;
    handleMoveNote(noteId, targetFolderId);
  };

  const { activeTodos, historyTodos } = useMemo(() => {
    let filtered = todos; if (filterCategory) filtered = filtered.filter(t => t.categoryId === filterCategory);
    const active = filtered.filter(t => t.status !== 'done'); const history = filtered.filter(t => t.status === 'done');
    active.sort((a, b) => (a.position !== undefined ? a.position : (a.dueDate ? new Date(a.dueDate).getTime() : (a.createdAt || Date.now()))) - (b.position !== undefined ? b.position : (b.dueDate ? new Date(b.dueDate).getTime() : (b.createdAt || Date.now()))));
    history.sort((a, b) => (b.completedAt || b.updatedAt) - (a.completedAt || a.updatedAt));
    return { activeTodos: active, historyTodos: history };
  }, [todos, filterCategory]);

  const handleDropTodo = async (e, targetPriority) => {
    e.preventDefault(); if (taskViewMode !== 'board') return;
    const type = e.dataTransfer.getData('type'); if (type === 'note') return; 
    const todoId = e.dataTransfer.getData('todoId'); if (!todoId) return;
    const container = e.currentTarget;
    const draggables = [...container.querySelectorAll('.draggable-card:not(.opacity-50)')];
    const afterElement = draggables.reduce((closest, child) => {
      const box = child.getBoundingClientRect(); const offset = e.clientY - box.top - box.height / 2;
      return (offset < 0 && offset > closest.offset) ? { offset, element: child } : closest;
    }, { offset: Number.NEGATIVE_INFINITY }).element;
    const colItems = activeTodos.filter(t => t.priority === targetPriority);
    let newPos;
    if (!afterElement) { newPos = colItems.length === 0 ? Date.now() : ((colItems[colItems.length - 1].position || Date.now()) + 100000); } 
    else {
      const idx = colItems.findIndex(t => t.id === afterElement.dataset.id); const afterPos = colItems[idx].position || Date.now();
      newPos = idx === 0 ? afterPos - 100000 : (colItems[idx - 1].position + afterPos) / 2;
    }
    try { await updateDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'todos', todoId), { priority: targetPriority, position: newPos, updatedAt: Date.now() }); } catch (err) {}
  };

  const cols = [
    { id: 'urgent', title: '緊急任務', textCls: 'text-red-700', dotCls: 'bg-red-500', items: activeTodos.filter(t => t.priority === 'urgent') },
    { id: 'semi', title: '次緊急任務', textCls: 'text-yellow-700', dotCls: 'bg-yellow-500', items: activeTodos.filter(t => t.priority === 'semi') },
    { id: 'normal', title: '非緊急任務', textCls: 'text-green-700', dotCls: 'bg-green-500', items: activeTodos.filter(t => t.priority === 'normal') },
  ];

  if (isLoading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 text-gray-500">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="animate-spin text-indigo-500" size={32} />
        <span>系統初始化中...</span>
      </div>
    </div>
  );

  // 🔴 登入防護牆 
  if (!user) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
        <div className="bg-white rounded-3xl shadow-xl w-full max-w-md p-8 flex flex-col items-center text-center animate-scale-up border border-gray-100 mb-6">
          <div className="w-20 h-20 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center mb-6 shadow-inner">
             <Cloud size={40} />
          </div>
          <h1 className="text-3xl font-black text-gray-900 mb-2 tracking-tight">NoteFlow</h1>
          <p className="text-gray-500 mb-8 font-medium">個人私有雲端筆記系統</p>
          
          <button 
            onClick={handleGoogleLogin} 
            disabled={isLoggingIn}
            className={"w-full bg-white border-2 border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 text-gray-800 font-bold py-3.5 px-4 rounded-xl flex items-center justify-center gap-3 transition-all " + (isLoggingIn ? "opacity-50 cursor-not-allowed" : "")}
          >
            {isLoggingIn ? <Loader2 className="animate-spin text-indigo-500" size={20} /> : <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google Logo" className="w-5 h-5" />}
            {isLoggingIn ? "連線驗證中..." : "使用 Google 帳號登入"}
          </button>
          
          <div className="mt-6 flex flex-col gap-1 items-center">
            <p className="text-xs text-gray-400 flex items-center gap-1"><ShieldAlert size={12}/> 僅限資料庫授權名單之帳戶登入</p>
          </div>
        </div>

        {/* 🌐 沙盒網域顯示器工具 */}
        <div className="bg-gray-800 text-gray-200 text-xs rounded-xl p-4 max-w-md w-full border border-gray-700 shadow-lg">
           <p className="font-bold text-white mb-2">🛠️ 開發者設定工具</p>
           <p className="mb-1 opacity-80">請將下方網址複製，並加入至以下兩個地方：</p>
           <ol className="list-decimal pl-4 mb-3 opacity-80 space-y-0.5">
             <li>Firebase -&gt; Authentication -&gt; Settings -&gt; Authorized domains</li>
             <li>Google Cloud Console -&gt; 憑證 -&gt; OAuth 用戶端 ID -&gt; 已授權的 JavaScript 來源</li>
           </ol>
           <div className="bg-black p-2 rounded flex justify-between items-center">
             <code className="text-green-400 select-all font-mono">{window.location.origin}</code>
           </div>
        </div>

        {toastMsg && <Toast message={toastMsg.message} type={toastMsg.type} onClose={() => setToastMsg(null)} />}
      </div>
    );
  }

  // 🟢 成功登入後的主介面
  return (
    <div className="min-h-screen bg-gray-50 text-gray-800 font-sans md:p-4 flex flex-col h-screen overflow-hidden">
      {!isOnline && (<div className="bg-red-500 text-white text-xs font-bold py-1.5 px-4 flex items-center justify-center gap-2 flex-shrink-0"><WifiOff size={14}/> 處於離線模式，變更已儲存在手機本地，網路恢復後將自動同步。</div>)}

      <header className="bg-white rounded-xl shadow-sm border border-gray-100 p-3 mb-3 mt-1 flex flex-col xl:flex-row justify-between items-center gap-4 z-10 flex-shrink-0">
        <div className="flex w-full xl:w-auto justify-between items-center gap-6">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-black text-gray-900 tracking-tight ml-2">NoteFlow</h1>
            <div className="hidden md:flex items-center gap-2 bg-gray-50 px-3 py-1 rounded-full border border-gray-100 group">
               <img src={user.photoURL || "https://via.placeholder.com/150"} alt="avatar" className="w-5 h-5 rounded-full" />
               <span className="text-xs font-bold text-gray-600 truncate max-w-[100px]">{user.displayName || user.email}</span>
               <button onClick={handleLogout} className="opacity-0 group-hover:opacity-100 ml-1 text-gray-400 hover:text-red-500 transition-all"><LogOut size={14}/></button>
            </div>
          </div>
          
          <div className="hidden md:flex bg-gray-100/80 p-1 rounded-lg border border-gray-200/50">
            <button onClick={() => setMainModule('tasks')} className={"px-5 py-1.5 text-sm font-bold rounded-md flex items-center gap-2 transition-all " + (mainModule === 'tasks' ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-700')}><CheckCircle2 size={16}/> 待辦事項</button>
            <button onClick={() => setMainModule('notes')} className={"px-5 py-1.5 text-sm font-bold rounded-md flex items-center gap-2 transition-all " + (mainModule === 'notes' ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-700')}><FolderOpen size={16}/> 自由紀錄區</button>
          </div>
        </div>
        {mainModule === 'tasks' ? (
          <div className="flex w-full xl:w-auto overflow-x-auto items-center gap-2 pb-1 xl:pb-0 hide-scrollbar">
            <div className="flex-shrink-0 relative flex items-center bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 focus-within:ring-2 focus-within:ring-indigo-500">
              <Filter size={16} className="text-gray-400 mr-2" />
              <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} className="bg-transparent text-sm font-medium text-gray-700 outline-none cursor-pointer pr-4"><option value="">所有分類</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            </div>
            <div className="h-6 w-px bg-gray-200 flex-shrink-0"></div>
            <div className="flex bg-gray-100 p-1 rounded-lg flex-shrink-0 mr-1">
              <button onClick={() => setTaskViewMode('board')} className={"px-3 py-1.5 text-xs font-bold rounded-md " + (taskViewMode === 'board' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500')}>看板</button>
              <button onClick={() => setTaskViewMode('history')} className={"px-3 py-1.5 text-xs font-bold rounded-md flex items-center gap-1 " + (taskViewMode === 'history' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500')}><History size={14}/> 歷史</button>
            </div>
            {taskViewMode === 'board' && (
              <div className="flex bg-gray-100 p-1 rounded-lg flex-shrink-0 mr-1 hidden sm:flex">
                <button onClick={() => setColsVisible(prev => ({...prev, urgent: !prev.urgent}))} className={"px-2 py-1.5 text-xs font-medium rounded-md flex items-center gap-1 " + (colsVisible.urgent ? 'bg-white text-red-600 shadow-sm' : 'text-gray-400')}><Eye size={14}/> 緊急</button>
                <button onClick={() => setColsVisible(prev => ({...prev, semi: !prev.semi}))} className={"px-2 py-1.5 text-xs font-medium rounded-md flex items-center gap-1 " + (colsVisible.semi ? 'bg-white text-yellow-600 shadow-sm' : 'text-gray-400')}><Eye size={14}/> 次緊急</button>
                <button onClick={() => setColsVisible(prev => ({...prev, normal: !prev.normal}))} className={"px-2 py-1.5 text-xs font-medium rounded-md flex items-center gap-1 " + (colsVisible.normal ? 'bg-white text-green-600 shadow-sm' : 'text-gray-400')}><Eye size={14}/> 非緊急</button>
              </div>
            )}
            {taskViewMode === 'board' && (<button onClick={() => setIsCategoryModalOpen(true)} className="flex-shrink-0 p-2 border border-gray-200 text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg flex items-center gap-1 text-sm font-medium"><Tags size={16} /> <span className="hidden md:inline">分類</span></button>)}
            <button onClick={() => setIsCreateTodoModalOpen(true)} className="flex-shrink-0 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg shadow-sm font-bold text-sm flex items-center gap-1"><Plus size={16}/> 新增</button>
          </div>
        ) : (
          <div className="flex w-full xl:w-auto overflow-x-auto items-center gap-2 pb-1 xl:pb-0 hide-scrollbar">
            <button onClick={() => setIsCreateFolderModalOpen(true)} className="flex-shrink-0 text-gray-600 bg-gray-100 hover:bg-gray-200 px-3 py-2 rounded-lg font-bold text-sm flex items-center gap-1"><Folder size={16}/> 新資料夾</button>
            <button onClick={() => createNote('doc')} className="flex-shrink-0 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg shadow-sm font-bold text-sm flex items-center gap-1"><FileText size={16}/> 新增筆記</button>
          </div>
        )}
      </header>

      {/* 手機版導航與登出 */}
      <div className="md:hidden flex bg-white border-b border-gray-200 p-1 rounded-lg mb-2 flex-shrink-0 items-center">
        <button onClick={() => setMainModule('tasks')} className={"flex-1 py-2 text-sm font-bold rounded-md flex justify-center items-center gap-2 " + (mainModule === 'tasks' ? 'bg-indigo-50 text-indigo-700' : 'text-gray-500')}><CheckCircle2 size={16}/> 任務</button>
        <button onClick={() => setMainModule('notes')} className={"flex-1 py-2 text-sm font-bold rounded-md flex justify-center items-center gap-2 " + (mainModule === 'notes' ? 'bg-indigo-50 text-indigo-700' : 'text-gray-500')}><FolderOpen size={16}/> 筆記</button>
        <div className="w-px h-6 bg-gray-200 mx-1"></div>
        <button onClick={handleLogout} className="px-3 py-2 text-gray-500 hover:text-red-500 flex justify-center"><LogOut size={16}/></button>
      </div>

      <main className="flex-1 overflow-hidden relative flex">
        {mainModule === 'tasks' && (
          <div className="w-full h-full overflow-x-auto overflow-y-auto pb-4 custom-scrollbar">
            {taskViewMode === 'board' ? (
              <div className={"grid gap-4 items-start min-w-[300px] animate-fade-in pb-10 " + (Object.values(colsVisible).filter(Boolean).length === 3 ? 'grid-cols-1 md:grid-cols-3' : Object.values(colsVisible).filter(Boolean).length === 2 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1')}>
                {cols.map(col => colsVisible[col.id] && (
                  <div key={col.id} className="bg-gray-100/50 rounded-2xl p-3 flex flex-col h-auto min-h-[150px] border border-gray-200/50" onDragOver={(e)=>e.preventDefault()} onDrop={(e) => handleDropTodo(e, col.id)}>
                    <div className="flex justify-between items-center mb-3 px-1">
                      <h2 className={"font-black text-[13px] tracking-widest uppercase flex items-center gap-2 " + col.textCls}>
                        <div className={"w-2 h-2 rounded-full " + col.dotCls}></div>{col.title}
                      </h2>
                      <span className="bg-white text-gray-500 text-xs font-bold px-2 py-0.5 rounded-full shadow-sm">{col.items.length}</span>
                    </div>
                    <div className="flex flex-col gap-2">
                      {col.items.map(todo => (
                        <TodoCard key={todo.id} todo={todo} categories={categories} 
                          onToggle={async(e) => { e.stopPropagation(); await updateDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'todos', todo.id), { status: 'done', completedAt: Date.now()}); showToast("已歸檔"); }} 
                          onClick={() => setActiveTodoDetail(todo)} 
                          onDelete={(e) => { e.stopPropagation(); reqConfirm("刪除任務", "確定刪除任務？", async() => { await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'todos', todo.id)); }); }} 
                          onDragStart={(e) => { e.dataTransfer.setData('type', 'todo'); e.dataTransfer.setData('todoId', todo.id); e.target.classList.add('opacity-50'); }} 
                          onDragEnd={(e) => e.target.classList.remove('opacity-50')} 
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-gray-100 p-6 max-w-4xl mx-auto h-full overflow-y-auto animate-fade-in shadow-sm">
                <h2 className="text-xl font-bold mb-6 flex items-center gap-2 text-gray-800"><History size={24} className="text-gray-400"/> 歷史歸檔任務</h2>
                <div className="space-y-3">{historyTodos.map(todo => (
                  <div key={todo.id} className="group bg-gray-50 hover:bg-gray-100 p-4 rounded-xl border border-gray-200 transition-colors flex justify-between items-center cursor-pointer" onClick={() => setActiveTodoDetail(todo)}>
                    <div className="flex items-center gap-3"><CheckCircle2 size={20} className="text-green-500 flex-shrink-0"/><div><span className="text-base font-medium text-gray-600 line-through">{todo.title}</span></div></div>
                    <div className="flex gap-2 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"><button onClick={async(e) => { e.stopPropagation(); await updateDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'todos', todo.id), { status: 'todo' }); showToast("已復原"); }} className="text-sm flex items-center gap-1 text-indigo-600 bg-white border border-indigo-100 px-3 py-1.5 rounded-lg"><Undo2 size={14}/> 復原</button></div>
                  </div>
                ))}</div>
              </div>
            )}
          </div>
        )}

        {mainModule === 'notes' && (
          <div className="flex w-full h-full gap-4 animate-fade-in">
            <div className="w-64 flex-shrink-0 bg-white rounded-2xl border border-gray-100 flex flex-col hidden md:flex shadow-sm">
              <div className="p-4 border-b border-gray-100 flex items-center justify-between"><h3 className="font-bold text-sm text-gray-500 uppercase tracking-wider flex items-center gap-2"><FolderOpen size={16}/> 檔案目錄</h3></div>
              <div className="flex-1 overflow-y-auto p-2 custom-scrollbar">
                 <button 
                  onDragOver={(e) => e.preventDefault()}
                  onDragEnter={(e) => e.currentTarget.classList.add('bg-indigo-50', 'border-indigo-400')}
                  onDragLeave={(e) => e.currentTarget.classList.remove('bg-indigo-50', 'border-indigo-400')}
                  onDrop={(e) => handleDropNoteToFolder(e, null)}
                  onClick={() => setCurrentFolderId(null)} 
                  className={"w-full text-left px-3 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 mb-1 border border-transparent transition-all " + (currentFolderId === null ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600 hover:bg-gray-50')}
                 >
                  <FolderOpen size={16} className={currentFolderId === null ? 'text-indigo-500' : 'text-gray-400'}/> 根目錄
                </button>
                <FolderTree folders={folders} parentId={null} currentFolderId={currentFolderId} onSelect={setCurrentFolderId} onDropNote={handleDropNoteToFolder} level={1} />
              </div>
            </div>

            <div className="flex-1 bg-white rounded-2xl border border-gray-100 flex flex-col overflow-hidden relative shadow-sm">
              <div className="px-5 py-3.5 border-b border-gray-100 bg-gray-50/50 flex items-center gap-2 text-sm font-medium text-gray-500">
                <button onClick={() => setCurrentFolderId(null)} className="hover:text-indigo-600 flex items-center gap-1 transition-colors"><Folder size={14}/> 根目錄</button>
                {currentFolderId && (<><ChevronRight size={14} className="text-gray-300" /><span className="text-gray-800 bg-white px-2 py-0.5 rounded border border-gray-200">{folders.find(f => f.id === currentFolderId)?.name || '未知'}</span></>)}
              </div>
              <div className="flex-1 overflow-y-auto p-5 md:p-8 custom-scrollbar bg-gray-50/30">
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 md:gap-5">
                  
                  {folders.filter(f => f.parentId === currentFolderId).map(folder => (
                    <div 
                      key={folder.id} 
                      onDragOver={(e) => e.preventDefault()}
                      onDragEnter={(e) => e.currentTarget.classList.add('bg-indigo-50', 'border-indigo-400')}
                      onDragLeave={(e) => e.currentTarget.classList.remove('bg-indigo-50', 'border-indigo-400')}
                      onDrop={(e) => handleDropNoteToFolder(e, folder.id)}
                      className="group relative bg-white border border-gray-200 rounded-2xl p-4 pt-8 md:p-5 md:pt-8 hover:border-indigo-300 hover:shadow-md transition-all cursor-pointer flex flex-col items-center gap-3" 
                      onClick={() => setCurrentFolderId(folder.id)}
                    >
                      <Folder size={48} className="text-indigo-400 drop-shadow-sm group-hover:scale-110 transition-transform" />
                      <span className="text-sm font-bold text-gray-700 truncate w-full text-center pointer-events-none px-2">{folder.name}</span>
                      <button onClick={(e) => { e.stopPropagation(); handleDeleteFolder(folder.id); }} className="absolute top-2 right-2 opacity-100 md:opacity-0 md:group-hover:opacity-100 p-1.5 text-gray-400 hover:text-red-500 bg-gray-50 hover:bg-red-50 rounded-lg transition-all border border-transparent"><Trash2 size={14}/></button>
                    </div>
                  ))}
                  
                  {notes.filter(n => n.folderId === currentFolderId).map(note => (
                    <div 
                      key={note.id} 
                      draggable 
                      onDragStart={(e) => { e.dataTransfer.setData('type', 'note'); e.dataTransfer.setData('noteId', note.id); e.target.classList.add('opacity-50'); }}
                      onDragEnd={(e) => e.target.classList.remove('opacity-50')}
                      className="group relative bg-white border border-gray-200 rounded-2xl p-4 pt-8 md:p-5 md:pt-8 hover:border-blue-300 hover:shadow-md transition-all cursor-pointer flex flex-col items-center gap-3" 
                      onClick={() => setActiveNoteDetail(note)}
                    >
                      <div className="absolute top-3 left-3 text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity hidden md:block cursor-grab"><GripHorizontal size={16} /></div>
                      <div className="w-12 h-12 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl flex items-center justify-center text-indigo-500 group-hover:from-indigo-500 group-hover:to-blue-600 group-hover:text-white transition-all shadow-sm"><FileText size={24} /></div>
                      <span className="text-sm font-bold text-gray-700 truncate w-full text-center pointer-events-none px-2">{note.title || '未命名筆記'}</span>
                      <span className="text-[10px] text-gray-400 font-medium pointer-events-none">{new Date(note.updatedAt).toLocaleDateString()}</span>
                      
                      <div className="absolute top-2 right-2 flex gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-all bg-white p-1 rounded-lg shadow-sm border border-gray-100 z-10">
                        <button onClick={(e) => { e.stopPropagation(); setMovingNoteId(note.id); }} className="p-1.5 text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-md" title="移動至..."><Move size={14}/></button>
                        <button onClick={(e) => { e.stopPropagation(); reqConfirm("刪除筆記", "確定永久刪除筆記？", async () => { await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'notes', note.id)); showToast("筆記已刪除"); }); }} className="p-1.5 text-gray-500 hover:text-red-500 hover:bg-red-50 rounded-md"><Trash2 size={14}/></button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {isCreateFolderModalOpen && (
        <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <form onSubmit={(e) => { e.preventDefault(); createFolder(e.target.folderName.value, currentFolderId); }} className="bg-white rounded-2xl shadow-2xl w-full max-w-xs p-6 animate-scale-up border border-gray-100"><h3 className="font-bold mb-4 text-gray-800 text-lg flex items-center gap-2"><Folder size={20} className="text-indigo-500"/> 新增資料夾</h3><input name="folderName" autoFocus required placeholder="名稱..." className="w-full border border-gray-300 rounded-xl p-3 outline-none focus:ring-2 focus:ring-indigo-500 mb-6 font-medium" /><div className="flex justify-end gap-3"><button type="button" onClick={() => setIsCreateFolderModalOpen(false)} className="px-4 py-2 text-gray-600 bg-gray-100 rounded-lg font-medium">取消</button><button type="submit" className="px-4 py-2 text-white bg-indigo-600 rounded-lg font-medium shadow-sm">建立</button></div></form>
        </div>
      )}
      
      {movingNoteId && (
        <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 animate-scale-up border border-gray-100">
            <h3 className="font-bold mb-4 text-gray-800 text-lg flex items-center gap-2"><Move size={20} className="text-indigo-500"/> 移動筆記至...</h3>
            <select id="moveSelect" className="w-full border border-gray-300 rounded-xl p-3 mb-6 outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
              <option value="root">📁 根目錄</option>
              {buildFolderOptions(null).map(opt => <option key={opt.id} value={opt.id}>📁 {opt.name}</option>)}
            </select>
            <div className="flex justify-end gap-3"><button onClick={() => setMovingNoteId(null)} className="px-4 py-2 text-gray-600 bg-gray-100 rounded-lg font-medium">取消</button><button onClick={() => handleMoveNote(movingNoteId, document.getElementById('moveSelect').value === 'root' ? null : document.getElementById('moveSelect').value)} className="px-4 py-2 text-white bg-indigo-600 rounded-lg font-medium shadow-sm">確定移動</button></div>
          </div>
        </div>
      )}

      {activeNoteDetail && <RichTextNoteEditorModal note={activeNoteDetail} folders={folders} buildFolderOptions={buildFolderOptions} onClose={() => setActiveNoteDetail(null)} user={user} appId={appId} db={db} showToast={showToast} reqConfirm={reqConfirm} />}

      {isCreateTodoModalOpen && <CreateTodoModal categories={categories} onClose={() => setIsCreateTodoModalOpen(false)} onSubmit={async(data) => { 
        const docRef = doc(collection(db, 'artifacts', appId, 'users', user.uid, 'todos')); 
        await setDoc(docRef, { ...data, status: 'todo', progress: [], position: data.dueDate ? new Date(data.dueDate).getTime() : Date.now() + 315360000000, createdAt: Date.now(), updatedAt: Date.now() }); 
        setIsCreateTodoModalOpen(false); showToast("任務建立成功"); 
      }} />}
      
      {activeTodoDetail && <TodoDetailModal todo={activeTodoDetail} categories={categories} user={user} appId={appId} db={db} onClose={() => setActiveTodoDetail(null)} showToast={showToast} reqConfirm={reqConfirm}/>}
      {isCategoryModalOpen && <CategoryManagerModal categories={categories} user={user} appId={appId} db={db} onClose={() => setIsCategoryModalOpen(false)} showToast={showToast} reqConfirm={reqConfirm}/>}
      
      <ConfirmModal {...confirmDialog} onCancel={() => setConfirmDialog({ isOpen: false })} />
      {toastMsg && <Toast message={toastMsg.message} type={toastMsg.type} onClose={() => setToastMsg(null)} />}
    </div>
  );
}

// ==========================================
// 🚀 富文本編輯器 (真實 Google Picker 實裝)
// ==========================================
function RichTextNoteEditorModal({ note, folders, buildFolderOptions, onClose, user, appId, db, showToast, reqConfirm }) {
  const [title, setTitle] = useState(note.title || '');
  const [content, setContent] = useState(note.content || '');
  const [folderId, setFolderId] = useState(note.folderId);
  const [attachments, setAttachments] = useState(note.attachments || []); 
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false); 
  
  const { isReady: isPickerReady, openPicker } = useGooglePicker(GOOGLE_CLIENT_ID, GOOGLE_API_KEY);
  const [showLargeFilePrompt, setShowLargeFilePrompt] = useState(false);

  const [canvases, setCanvases] = useState(() => {
    if (note.canvases && note.canvases.length > 0) return note.canvases;
    if (note.canvasData) return [{ id: 'legacy-canvas', data: note.canvasData }];
    return [];
  });

  const editorRef = useRef(null); const isMounted = useRef(false);
  const [isListening, setIsListening] = useState(false); const [recognition, setRecognition] = useState(null);

  useEffect(() => { if (!isMounted.current && editorRef.current) { editorRef.current.innerHTML = note.content || ''; isMounted.current = true; } }, [note.content]);

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const r = new SpeechRecognition(); r.continuous = true; r.interimResults = true; r.lang = 'zh-TW';
      r.onresult = (event) => {
        let finalTranscripts = '';
        for (let i = event.resultIndex; i < event.results.length; i++) { if (event.results[i].isFinal) finalTranscripts += event.results[i][0].transcript; }
        if (finalTranscripts && editorRef.current) {
           editorRef.current.innerHTML += finalTranscripts + '，'; setContent(editorRef.current.innerHTML); 
           const range = document.createRange(); const sel = window.getSelection(); range.selectNodeContents(editorRef.current); range.collapse(false); sel.removeAllRanges(); sel.addRange(range);
        }
      };
      r.onerror = (e) => { setIsListening(false); }; r.onend = () => { setIsListening(false); };
      setRecognition(r);
    }
  }, []);

  const toggleListening = () => { if (!recognition) return showToast("您的瀏覽器不支援語音辨識", "error"); if (isListening) { recognition.stop(); setIsListening(false); } else { recognition.start(); setIsListening(true); showToast("開始聆聽..."); } };

  const checkStorageLimit = (newDataByteSize = 0) => {
    const payloadSize = new Blob([JSON.stringify({ content, attachments, canvases })]).size;
    if (payloadSize + newDataByteSize > 900 * 1024) { showToast("⛔ 整體筆記容量接近 1MB 雲端上限！", "error"); return false; }
    return true;
  };

  useEffect(() => {
    const timer = setTimeout(async () => {
      setIsSaving(true);
      try {
        const payload = { title, content, attachments, canvases, folderId, updatedAt: Date.now() };
        if (note.canvasData !== undefined) payload.canvasData = deleteField();
        await updateDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'notes', note.id), payload);
      } catch(err) {} finally { setIsSaving(false); }
    }, 1500); 
    return () => clearTimeout(timer);
  }, [title, content, attachments, canvases, folderId, note.id, user.uid, db, appId, note.canvasData]);

  const compressImage = (file) => {
    return new Promise((resolve) => {
      const reader = new FileReader(); reader.readAsDataURL(file);
      reader.onload = (event) => {
        const img = new Image(); img.src = event.target.result;
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let { width, height } = img; const MAX_DIM = 1200;
          if (width > height && width > MAX_DIM) { height *= MAX_DIM / width; width = MAX_DIM; }
          else if (height > MAX_DIM) { width *= MAX_DIM / height; height = MAX_DIM; }
          canvas.width = width; canvas.height = height;
          const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.8));
        };
      };
    });
  };

  const handleInlineImage = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    setIsUploading(true);
    try {
      const compressedBase64 = await compressImage(file);
      if(!checkStorageLimit(new Blob([compressedBase64]).size)) { e.target.value = ''; setIsUploading(false); return; }
      if (editorRef.current) { editorRef.current.focus(); document.execCommand('insertImage', false, compressedBase64); setContent(editorRef.current.innerHTML); }
    } catch(err) { showToast("圖片處理失敗", "error"); }
    setIsUploading(false); e.target.value = '';
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0]; if (!file) return;
    if (file.size > 800 * 1024) { setShowLargeFilePrompt(true); e.target.value = ''; return; }
    
    const reader = new FileReader();
    reader.onload = (ev) => { 
      const b64 = ev.target.result;
      if(!checkStorageLimit(new Blob([b64]).size)) { e.target.value = ''; return; }
      setAttachments(prev => [...prev, { id: crypto.randomUUID(), name: file.name, type: 'native', data: b64 }]); 
      e.target.value = ''; 
    };
    reader.readAsDataURL(file);
  };

  const handleOpenGooglePicker = () => {
    setShowLargeFilePrompt(false);
    openPicker(
      (googleDoc) => {
        setAttachments(prev => [...prev, { 
          id: crypto.randomUUID(), 
          name: googleDoc.name, 
          type: 'drive-picker', 
          url: googleDoc.url,
          iconUrl: googleDoc.iconUrl
        }]);
        showToast("已成功從 Google Drive 載入附檔！");
      },
      (errorMsg) => { showToast("開啟 Google Drive 失敗，請確認已設定金鑰", "error"); }
    );
  };

  const removeAttachment = (id) => reqConfirm("移除附件", "確定要移除此檔案或連結嗎？", () => setAttachments(prev => prev.filter(a => a.id !== id)));

  const addCanvas = () => { 
    if(!checkStorageLimit(50000)) return; 
    setCanvases(prev => [...prev, { id: crypto.randomUUID(), data: null }]); 
    setTimeout(() => { const scrollableDiv = document.getElementById('note-scroll-container'); if(scrollableDiv) scrollableDiv.scrollTo({ top: scrollableDiv.scrollHeight, behavior: 'smooth' }); }, 100); 
  };
  const updateCanvasData = (id, data) => setCanvases(prev => prev.map(c => c.id === id ? { ...c, data } : c));
  const removeCanvas = (id) => reqConfirm("刪除畫板", "確定要移除這塊畫板嗎？畫作將無法復原。", () => setCanvases(prev => prev.filter(c => c.id !== id)));

  return (
    <div className="fixed inset-0 bg-gray-50 z-[60] flex flex-col animate-scale-up overflow-hidden">
      <header className="px-4 py-3 border-b border-gray-200 flex justify-between items-center bg-white shadow-sm flex-shrink-0">
        <div className="flex items-center gap-4">
          <button onClick={onClose} className="p-2 bg-gray-50 hover:bg-gray-100 rounded-lg text-gray-600 transition-colors"><ArrowLeft size={20}/></button>
          <div className="flex flex-col md:flex-row md:items-center gap-1 md:gap-3">
            <span className={"text-xs font-bold " + (!navigator.onLine ? 'text-red-500' : isSaving ? 'text-indigo-500' : 'text-green-500')}>{!navigator.onLine ? '⚡ 離線暫存中' : isSaving ? '同步雲端中...' : '已儲存'}</span>
            <select value={folderId || 'root'} onChange={(e) => setFolderId(e.target.value === 'root' ? null : e.target.value)} className="text-xs bg-gray-100 text-gray-600 border-none rounded py-1 px-2 font-medium outline-none cursor-pointer hidden md:block"><option value="root">📁 根目錄</option>{buildFolderOptions(null).map(opt => <option key={opt.id} value={opt.id}>📁 {opt.name}</option>)}</select>
          </div>
        </div>

        <div className="flex items-center gap-1.5 md:gap-2 bg-gray-50 p-1.5 rounded-xl border border-gray-100 overflow-x-auto hide-scrollbar">
          {isUploading && <div className="flex items-center gap-2 text-indigo-600 font-bold text-xs px-2"><Loader2 className="animate-spin" size={16}/> 處理中</div>}
          
          <button onClick={toggleListening} disabled={isUploading} className={"flex-shrink-0 p-2 rounded-lg font-bold text-sm flex items-center gap-1.5 transition-all " + (isListening ? 'bg-red-100 text-red-600 animate-pulse' : 'text-gray-600 hover:bg-gray-200') + (isUploading ? " opacity-50" : "")}><Mic size={18}/> <span className="hidden md:inline">語音</span></button>
          <div className="w-px h-6 bg-gray-300"></div>
          <label className="flex-shrink-0 p-2 rounded-lg text-gray-600 hover:bg-gray-200 cursor-pointer flex items-center gap-1.5 transition-all font-bold text-sm"><ImageIcon size={18}/> <span className="hidden md:inline">圖片</span><input type="file" accept="image/*" onChange={handleInlineImage} className="hidden" disabled={isUploading} /></label>
          <label className="flex-shrink-0 p-2 rounded-lg text-gray-600 hover:bg-gray-200 cursor-pointer flex items-center gap-1.5 transition-all font-bold text-sm"><Paperclip size={18}/> <span className="hidden md:inline">本地附檔</span><input type="file" onChange={handleFileUpload} className="hidden" disabled={isUploading} /></label>
          
          <button onClick={handleOpenGooglePicker} disabled={isUploading || !isPickerReady} className="flex-shrink-0 p-2 rounded-lg font-bold text-sm flex items-center gap-1.5 transition-all text-blue-600 hover:bg-blue-100 disabled:opacity-50" title={!isPickerReady ? "金鑰未設定或載入中" : ""}>
            <Cloud size={18}/> <span className="hidden md:inline">雲端檔案</span>
          </button>
          
          <div className="w-px h-6 bg-gray-300"></div>
          <button onClick={addCanvas} disabled={isUploading} className="flex-shrink-0 p-2 rounded-lg font-bold text-sm flex items-center gap-1.5 transition-all text-indigo-600 hover:bg-indigo-100 disabled:opacity-50"><Palette size={18}/> <span className="hidden md:inline">加畫板</span></button>
        </div>
      </header>

      <main id="note-scroll-container" className="flex-1 overflow-y-auto p-4 md:p-8 flex justify-center bg-white custom-scrollbar scroll-smooth">
        <div className="w-full max-w-4xl flex flex-col gap-6 pb-32">
          <input value={title} onChange={(e)=>setTitle(e.target.value)} placeholder="為這篇筆記下個標題..." className="text-3xl md:text-5xl font-black text-gray-900 border-none outline-none placeholder-gray-300 bg-transparent px-4" />
          
          <div className="relative px-4 border-l-2 border-transparent focus-within:border-indigo-200 transition-colors">
            <div ref={editorRef} contentEditable="true" onInput={(e) => setContent(e.currentTarget.innerHTML)} className="rich-editor min-h-[150px] w-full text-lg leading-relaxed text-gray-800 outline-none" placeholder="開始輸入文字，或者插入圖片..." style={{ minHeight: '150px' }} />
            {isListening && <div className="fixed bottom-10 right-10 flex items-center gap-2 bg-white px-4 py-2 rounded-full shadow-lg border border-red-100 z-50"><div className="w-2.5 h-2.5 bg-red-500 rounded-full animate-ping"></div><span className="text-sm font-bold text-red-500">正在聆聽並輸入...</span></div>}
          </div>

          {attachments.length > 0 && (
            <div className="px-4 mt-4">
              <h4 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-2"><Paperclip size={16}/> 附件與雲端檔案 ({attachments.length})</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {attachments.map(file => (
                  <div key={file.id} className="flex items-center justify-between p-3 bg-gray-50 border border-gray-200 rounded-xl hover:border-indigo-300 transition-colors">
                    <div className="flex items-center gap-3 min-w-0">
                      
                      <div className={"w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 " + (file.type === 'drive-picker' ? 'bg-transparent' : 'bg-indigo-50 text-indigo-500')}>
                        {file.type === 'drive-picker' ? <img src={file.iconUrl} alt="drive icon" className="w-6 h-6" /> : <FileText size={20}/>}
                      </div>
                      
                      <div className="min-w-0 flex flex-col">
                        <span className="text-sm font-bold text-gray-700 truncate">{file.name}</span>
                        {file.type === 'drive-picker' ? (
                          <a href={file.url} target="_blank" rel="noreferrer" className="text-[10px] text-blue-500 hover:text-blue-700 text-left underline font-bold mt-0.5 flex items-center gap-1">在 Google Drive 檢視 <ExternalLink size={10}/></a>
                        ) : (
                          <a href={file.data} download={file.name} className="text-[10px] text-indigo-500 hover:text-indigo-700 text-left underline font-bold mt-0.5">下載本地附件</a>
                        )}
                      </div>

                    </div>
                    <button onClick={() => removeAttachment(file.id)} className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg"><Trash2 size={16}/></button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {canvases.map((canvas, index) => (
            <div key={canvas.id} className="px-4 mt-6">
               <h4 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-3 flex items-center justify-between"><span className="flex items-center gap-2"><Palette size={16}/> 畫布區塊 {index + 1}</span></h4>
               <CanvasBoard initialData={canvas.data} onChange={(data) => updateCanvasData(canvas.id, data)} onRemove={() => removeCanvas(canvas.id)} />
            </div>
          ))}
        </div>
      </main>

      {/* 🔥 擋下過大檔案的引導 Modal */}
      {showLargeFilePrompt && (
        <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-[100]">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 animate-scale-up border border-gray-100">
            <div className="flex items-center gap-3 text-blue-600 mb-4">
              <Cloud size={28} />
              <h3 className="text-xl font-bold">檔案體積過大</h3>
            </div>
            
            <p className="text-gray-600 mb-6 leading-relaxed">
              為了確保筆記本載入速度，超過限制的檔案將透過 <strong>Google Drive</strong> 進行處理。<br/><br/>
              請點擊下方按鈕開啟授權面板，並在面板中直接 <strong className="text-blue-600">拖曳或選擇檔案</strong> 上傳。
            </p>

            <div className="flex justify-end gap-3">
              <button onClick={() => setShowLargeFilePrompt(false)} className="px-4 py-2 text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg font-medium transition-colors">取消</button>
              <button onClick={handleOpenGooglePicker} disabled={!isPickerReady} className="px-4 py-2 text-white bg-blue-600 hover:bg-blue-700 rounded-lg font-medium shadow-sm transition-colors disabled:opacity-50">
                開啟 Google Drive 面板
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

function CanvasBoard({ initialData, onChange, onRemove }) {
  const canvasRef = useRef(null); const ctxRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false); const [brushColor, setBrushColor] = useState('#000000'); const [brushSize, setBrushSize] = useState(3); const [isEraser, setIsEraser] = useState(false);

  useEffect(() => {
    if (canvasRef.current) {
      const canvas = canvasRef.current; canvas.width = canvas.parentElement.offsetWidth; canvas.height = 500;
      const ctx = canvas.getContext('2d'); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctxRef.current = ctx;
      if (initialData) { const img = new Image(); img.src = initialData; img.onload = () => ctx.drawImage(img, 0, 0); } else { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    }
  }, []);

  const startDrawing = ({ nativeEvent }) => { if (!ctxRef.current) return; const { offsetX, offsetY } = getCoordinates(nativeEvent); ctxRef.current.beginPath(); ctxRef.current.moveTo(offsetX, offsetY); setIsDrawing(true); };
  const draw = ({ nativeEvent }) => { if (!isDrawing || !ctxRef.current) return; nativeEvent.preventDefault(); const { offsetX, offsetY } = getCoordinates(nativeEvent); ctxRef.current.strokeStyle = isEraser ? '#ffffff' : brushColor; ctxRef.current.lineWidth = isEraser ? brushSize * 3 : brushSize; ctxRef.current.lineTo(offsetX, offsetY); ctxRef.current.stroke(); };
  const stopDrawing = () => { if (!isDrawing) return; ctxRef.current.closePath(); setIsDrawing(false); onChange(canvasRef.current.toDataURL('image/png')); };
  const getCoordinates = (event) => { if (event.touches && event.touches.length > 0) { const touch = event.touches[0]; const rect = canvasRef.current.getBoundingClientRect(); return { offsetX: touch.clientX - rect.left, offsetY: touch.clientY - rect.top }; } return { offsetX: event.offsetX, offsetY: event.offsetY }; };
  const clearCanvas = () => { if(!ctxRef.current) return; ctxRef.current.fillStyle = '#ffffff'; ctxRef.current.fillRect(0, 0, canvasRef.current.width, canvasRef.current.height); onChange(canvasRef.current.toDataURL('image/png')); };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden flex flex-col animate-fade-in w-full">
      <div className="bg-gray-50 border-b border-gray-200 p-2.5 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <input type="color" value={brushColor} onChange={(e)=>setBrushColor(e.target.value)} disabled={isEraser} className="w-8 h-8 rounded cursor-pointer border-0 p-0" />
          <input type="range" min="1" max="20" value={brushSize} onChange={(e)=>setBrushSize(e.target.value)} className="w-20 md:w-32 accent-indigo-500" />
          <div className="w-px h-6 bg-gray-300 mx-1"></div>
          <button onClick={() => setIsEraser(false)} className={"p-1.5 md:p-2 rounded-lg " + (!isEraser ? 'bg-indigo-100 text-indigo-700' : 'text-gray-500 hover:bg-gray-200')}><PenTool size={18}/></button>
          <button onClick={() => setIsEraser(true)} className={"p-1.5 md:p-2 rounded-lg " + (isEraser ? 'bg-indigo-100 text-indigo-700' : 'text-gray-500 hover:bg-gray-200')}><Eraser size={18}/></button>
        </div>
        <div className="flex items-center gap-2"><button onClick={clearCanvas} className="text-xs font-bold text-gray-500 hover:bg-gray-200 px-3 py-1.5 rounded-lg transition-colors">清空</button><button onClick={onRemove} className="text-xs font-bold text-white bg-red-500 hover:bg-red-600 px-2 py-1.5 rounded-lg transition-colors flex items-center gap-1"><Trash2 size={12}/> <span className="hidden sm:inline">刪除畫布</span></button></div>
      </div>
      <div className="w-full h-[500px] relative overflow-hidden bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:16px_16px]"><canvas ref={canvasRef} onMouseDown={startDrawing} onMouseMove={draw} onMouseUp={stopDrawing} onMouseOut={stopDrawing} onTouchStart={startDrawing} onTouchMove={draw} onTouchEnd={stopDrawing} className="absolute inset-0 w-full h-full touch-none cursor-crosshair" style={{ touchAction: 'none' }} /></div>
    </div>
  );
}

function FolderTree({ folders, parentId, currentFolderId, onSelect, onDropNote, level }) {
  const children = folders.filter(f => f.parentId === parentId); if (children.length === 0) return null;
  return (
    <div className="space-y-1 mt-1">
      {children.map(folder => (
        <div key={folder.id}>
          <button onDragOver={(e) => e.preventDefault()} onDragEnter={(e) => e.currentTarget.classList.add('bg-indigo-50', 'border-indigo-400')} onDragLeave={(e) => e.currentTarget.classList.remove('bg-indigo-50', 'border-indigo-400')} onDrop={(e) => onDropNote(e, folder.id)} onClick={() => onSelect(folder.id)} className={"w-full text-left py-2 pr-2 rounded-xl text-sm font-bold flex items-center gap-2 border border-transparent transition-all " + (currentFolderId === folder.id ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600 hover:bg-gray-50')} style={{ paddingLeft: (level * 16 + 12) + "px" }}>
            {folders.some(f => f.parentId === folder.id) ? <ChevronDown size={14} className="text-gray-400"/> : <span className="w-3.5 inline-block"></span>}<Folder size={14} className={currentFolderId === folder.id ? 'text-indigo-500' : 'text-gray-400'} /><span className="truncate pointer-events-none">{folder.name}</span>
          </button>
          <FolderTree folders={folders} parentId={folder.id} currentFolderId={currentFolderId} onSelect={onSelect} onDropNote={onDropNote} level={level + 1} />
        </div>
      ))}
    </div>
  );
}

function TodoCard({ todo, categories, onToggle, onClick, onDelete, onDragStart, onDragEnd }) {
  const cat = categories.find(c => c.id === todo.categoryId);
  const [isExpanded, setIsExpanded] = useState(false);
  
  let isOverdue = false; let dueText = '';
  if (todo.dueDate) { const d = new Date(todo.dueDate); d.setHours(23,59,59); isOverdue = d < new Date() && todo.status !== 'done'; dueText = d.toLocaleDateString('zh-TW',{month:'short',day:'numeric'}); }
  
  return (
    <div draggable data-id={todo.id} onDragStart={onDragStart} onDragEnd={onDragEnd} onClick={onClick} className={"draggable-card group bg-white p-3 md:p-4 rounded-xl shadow-sm border cursor-pointer flex flex-col gap-2 transition-all " + (isOverdue ? 'border-red-300 bg-red-50' : 'border-white hover:border-indigo-200')}>
      {todo.dueDate && (<div className={"text-[10px] md:text-[11px] font-bold flex items-center gap-1 w-max px-2 py-0.5 rounded " + (isOverdue ? 'bg-red-100 text-red-600' : 'bg-blue-50 text-blue-600')}><Calendar size={12} /> {isOverdue ? "已逾期 (" + dueText + ")" : dueText + " 截止"}</div>)}
      <div className="flex gap-2.5 items-start">
        <div className="text-gray-300 mt-0.5 cursor-grab hidden md:block opacity-0 group-hover:opacity-100"><GripVertical size={16} /></div>
        <button onClick={onToggle} title="標示為完成" className="mt-0.5 flex-shrink-0 text-gray-300 hover:text-green-500 group/btn transition-colors"><Circle size={20} className="block group-hover/btn:hidden" /><CheckCircle2 size={20} className="hidden group-hover/btn:block" /></button>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm md:text-base font-bold text-gray-800 leading-tight">{todo.title}</h3>
          <div className="flex flex-wrap gap-2 mt-2 items-center">
            {cat && <span className="text-[10px] px-2 py-0.5 rounded bg-gray-50 text-gray-600 border"><Tags size={10}/> {cat.name}</span>}
            {/* 🔥 如果有任務說明，顯示小圖示 */}
            {todo.description && <span className="text-gray-400" title="有任務說明"><AlignLeft size={14}/></span>}
            
            {(todo.progress || []).length > 0 && (
              <button onClick={(e) => { e.stopPropagation(); setIsExpanded(!isExpanded); }} className="text-[10px] text-gray-500 hover:text-indigo-600 flex items-center gap-1 bg-gray-50 px-2 py-0.5 rounded border transition-colors shadow-sm">
                <Clock size={10}/> {todo.progress.length} 筆進度 {isExpanded ? <ChevronUp size={12}/> : <ChevronDown size={12}/>}
              </button>
            )}
          </div>
          {isExpanded && (todo.progress || []).length > 0 && (
            <div className="mt-3 pl-2 border-l-2 border-indigo-200 space-y-2 max-h-40 overflow-y-auto custom-scrollbar pr-1 animate-fade-in" onClick={(e) => e.stopPropagation()}>
               {todo.progress.map(p => (
                 <div key={p.id} className="text-xs text-gray-600 bg-gray-50 border border-gray-100 p-2 rounded-lg">
                   <div className="text-[9px] text-gray-400 mb-0.5 font-bold">{new Date(p.createdAt).toLocaleDateString('zh-TW', {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'})}</div>
                   <div className="break-words leading-relaxed whitespace-pre-wrap">{p.text}</div>
                 </div>
               ))}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"><button onClick={onDelete} className="p-1.5 text-gray-400 hover:text-red-500 bg-gray-50 rounded-lg"><Trash2 size={16} /></button></div>
      </div>
    </div>
  );
}

function CreateTodoModal({categories, onClose, onSubmit}) {
  const [f, setF] = useState({title:'', categoryId:'', priority:'semi', dueDate:'', description:''});
  return (
    <div className="fixed inset-0 bg-gray-900/50 flex items-center justify-center p-4 z-50"><form onSubmit={(e)=>{e.preventDefault(); f.title.trim() && onSubmit(f);}} className="bg-white rounded-2xl w-full max-w-md p-6 shadow-xl animate-scale-up">
      <div className="flex justify-between mb-5"><h3 className="font-bold text-xl">新增任務</h3><button type="button" onClick={onClose}><X size={20}/></button></div>
      <div className="space-y-4">
        <div><label className="block text-sm font-bold mb-1">任務名稱 *</label><input autoFocus required value={f.title} onChange={e=>setF({...f, title:e.target.value})} className="w-full border rounded-xl p-3 outline-none focus:ring-2 focus:ring-indigo-500"/></div>
        <div className="grid grid-cols-2 gap-4"><div><label className="block text-sm font-bold mb-1">死線</label><input type="date" value={f.dueDate} onChange={e=>setF({...f, dueDate:e.target.value})} className="w-full border rounded-xl p-2.5 text-sm outline-none"/></div><div><label className="block text-sm font-bold mb-1">緊急程度</label><select value={f.priority} onChange={e=>setF({...f, priority:e.target.value})} className="w-full border rounded-xl p-2.5 text-sm outline-none"><option value="urgent">🔴 緊急</option><option value="semi">🟡 次緊急</option><option value="normal">🟢 非緊急</option></select></div></div>
        <div><label className="block text-sm font-bold mb-1">分類標籤</label><select value={f.categoryId} onChange={e=>setF({...f, categoryId:e.target.value})} className="w-full border rounded-xl p-2.5 text-sm outline-none"><option value="">無分類</option>{categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        {/* 🔥 更改文案為「任務說明」，並且作為獨立欄位 */}
        <div><label className="block text-sm font-bold mb-1">任務說明 (選填)</label><textarea value={f.description} onChange={e=>setF({...f, description:e.target.value})} className="w-full border rounded-xl p-3 text-sm h-20 outline-none focus:ring-2 focus:ring-indigo-500" placeholder="任務的詳細內容或備註..." /></div>
      </div>
      <div className="flex justify-end gap-3 mt-6"><button type="button" onClick={onClose} className="px-5 py-2.5 bg-gray-100 rounded-xl font-bold">取消</button><button type="submit" className="px-5 py-2.5 bg-indigo-600 text-white rounded-xl font-bold">建立</button></div>
    </form></div>
  );
}

// 🔥 全新升級的任務詳情面板：支援標題編輯、獨立說明區塊
function TodoDetailModal({ todo, categories, user, appId, db, onClose, showToast, reqConfirm }) {
  const [nt, setNt] = useState(''); 
  const [editId, setEditId] = useState(null); 
  const [editText, setEditText] = useState('');
  
  // 編輯狀態
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState(todo.title);
  const [isEditingDesc, setIsEditingDesc] = useState(false);
  const [editDesc, setEditDesc] = useState(todo.description || '');

  const updateField = async (f, v) => { try { await updateDoc(doc(db,'artifacts',appId,'users',user.uid,'todos',todo.id), { [f]: v, updatedAt:Date.now() }); } catch (err) {} };
  
  const saveTitle = async () => { if(editTitle.trim() && editTitle !== todo.title) { await updateField('title', editTitle); } setIsEditingTitle(false); };
  const saveDesc = async () => { if(editDesc !== todo.description) { await updateField('description', editDesc); } setIsEditingDesc(false); };

  return (
    <div className="fixed inset-0 bg-gray-900/40 flex justify-end z-50">
      <div className="bg-white w-full md:w-[450px] h-full flex flex-col shadow-2xl animate-slide-in-right">
        
        {/* 標頭區 */}
        <div className="p-5 border-b bg-gray-50">
          <div className="flex justify-between items-start mb-4">
            
            {/* 標題編輯區 */}
            {isEditingTitle ? (
              <div className="flex-1 mr-3 flex flex-col gap-2">
                <input autoFocus value={editTitle} onChange={e=>setEditTitle(e.target.value)} className="w-full text-lg font-bold border border-gray-300 rounded px-3 py-1.5 outline-none focus:ring-2 focus:ring-indigo-500" />
                <div className="flex gap-2">
                  <button onClick={saveTitle} className="text-xs bg-indigo-600 text-white font-bold px-3 py-1.5 rounded">儲存標題</button>
                  <button onClick={()=>{setEditTitle(todo.title); setIsEditingTitle(false);}} className="text-xs bg-gray-200 text-gray-700 font-bold px-3 py-1.5 rounded">取消</button>
                </div>
              </div>
            ) : (
              <div className="flex-1 mr-3 group flex items-start justify-between cursor-pointer" onClick={()=>setIsEditingTitle(true)}>
                 <h2 className={"text-xl font-bold " + (todo.status==='done' ? 'line-through text-gray-400' : 'text-gray-800')}>{todo.title}</h2>
                 <button className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-indigo-600 transition-opacity"><Edit2 size={16}/></button>
              </div>
            )}
            
            <button onClick={onClose} className="p-1.5 text-gray-400 hover:bg-gray-200 rounded-lg transition-colors"><X size={20}/></button>
          </div>
          
          <div className="grid grid-cols-3 gap-2">
            <div><label className="text-[10px] font-bold text-gray-500 uppercase">緊急程度</label><select disabled={todo.status==='done'} value={todo.priority||'semi'} onChange={e=>updateField('priority',e.target.value)} className="w-full text-xs md:text-sm border rounded-lg p-2"><option value="urgent">🔴 緊急</option><option value="semi">🟡 次緊</option><option value="normal">🟢 非緊</option></select></div>
            <div><label className="text-[10px] font-bold text-gray-500 uppercase">死線</label><input type="date" disabled={todo.status==='done'} value={todo.dueDate||''} onChange={e=>updateField('dueDate',e.target.value)} className="w-full text-xs md:text-sm border rounded-lg p-2" /></div>
            <div><label className="text-[10px] font-bold text-gray-500 uppercase">分類</label><select disabled={todo.status==='done'} value={todo.categoryId||''} onChange={e=>updateField('categoryId',e.target.value)} className="w-full text-xs md:text-sm border rounded-lg p-2"><option value="">無分類</option>{categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          </div>
        </div>

        {/* 內容區 */}
        <div className="flex-1 overflow-y-auto p-5 custom-scrollbar">
          
          {/* 🔥 獨立的任務說明區塊 */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2 group">
              <h3 className="text-sm font-bold text-gray-400 flex items-center gap-2"><AlignLeft size={16}/> 任務說明</h3>
              {!isEditingDesc && <button onClick={()=>setIsEditingDesc(true)} className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-indigo-600 transition-opacity"><Edit2 size={14}/></button>}
            </div>
            
            {isEditingDesc ? (
              <div className="flex flex-col gap-2">
                <textarea autoFocus value={editDesc} onChange={e=>setEditDesc(e.target.value)} className="w-full border border-gray-300 rounded-xl p-3 text-sm outline-none focus:ring-2 focus:ring-indigo-500 min-h-[100px]" placeholder="添加任務詳細說明..." />
                <div className="flex gap-2 justify-end">
                   <button onClick={()=>{setEditDesc(todo.description || ''); setIsEditingDesc(false);}} className="text-xs bg-gray-200 text-gray-700 font-bold px-4 py-2 rounded-lg">取消</button>
                   <button onClick={saveDesc} className="text-xs bg-indigo-600 text-white font-bold px-4 py-2 rounded-lg shadow-sm">儲存說明</button>
                </div>
              </div>
            ) : (
              <div className="text-sm text-gray-600 bg-gray-50 p-4 rounded-xl border border-gray-100 whitespace-pre-wrap min-h-[60px] cursor-pointer hover:bg-gray-100 transition-colors" onClick={()=>setIsEditingDesc(true)}>
                {todo.description ? todo.description : <span className="text-gray-400 italic">點擊添加任務說明...</span>}
              </div>
            )}
          </div>

          <h3 className="text-sm font-bold text-gray-400 mb-5 flex items-center gap-2"><Clock size={16}/>進度時間軸</h3>
          <div className="border-l-2 border-indigo-100 ml-3 space-y-6">
            {(todo.progress||[]).length === 0 && <div className="text-xs text-gray-400 pl-4 italic">尚無進度紀錄</div>}
            {(todo.progress||[]).map(p=>(
              <div key={p.id} className="relative pl-6 group">
                <div className="absolute -left-[9px] top-1 w-4 h-4 rounded-full bg-indigo-50 border-2 border-indigo-400"></div>
                {editId===p.id ? (
                  <div className="bg-indigo-50 p-3 rounded-xl border border-indigo-100">
                    <textarea value={editText} onChange={e=>setEditText(e.target.value)} className="w-full p-2 text-sm border rounded outline-none"/>
                    <div className="flex justify-end gap-2 mt-2">
                      <button onClick={()=>setEditId(null)} className="text-xs px-3 py-1 bg-white border rounded font-bold">取消</button>
                      <button onClick={async()=>{await updateDoc(doc(db,'artifacts',appId,'users',user.uid,'todos',todo.id),{progress:todo.progress.map(x=>x.id===p.id?{...x,text:editText}:x),updatedAt:Date.now()});setEditId(null);}} className="text-xs px-3 py-1 bg-indigo-600 text-white rounded font-bold">儲存</button>
                    </div>
                  </div>
                ) : (
                  <div className="bg-gray-50 p-3.5 rounded-xl relative">
                    {todo.status!=='done' && (
                      <div className="absolute top-2 right-2 opacity-100 md:opacity-0 md:group-hover:opacity-100 flex gap-1 bg-white p-0.5 rounded shadow-sm">
                        <button onClick={()=>{setEditId(p.id);setEditText(p.text);}} className="p-1 hover:text-indigo-600"><Edit2 size={14}/></button>
                        <button onClick={()=>reqConfirm("刪除紀錄","確定刪除？",async()=>await updateDoc(doc(db,'artifacts',appId,'users',user.uid,'todos',todo.id),{progress:todo.progress.filter(x=>x.id!==p.id)}))} className="p-1 hover:text-red-500"><Trash2 size={14}/></button>
                      </div>
                    )}
                    <div className="text-[10px] text-gray-400 mb-1">{new Date(p.createdAt).toLocaleString()}</div>
                    <div className="text-sm leading-relaxed whitespace-pre-wrap">{p.text}</div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
        
        {/* 發布進度輸入框 */}
        {todo.status!=='done' && (
          <div className="p-4 border-t flex gap-2">
            <textarea value={nt} onChange={e=>setNt(e.target.value)} className="flex-1 border rounded-xl p-3 text-sm h-14 outline-none focus:ring-2 focus:ring-indigo-500" placeholder="發佈新進度..."/>
            <button onClick={async()=>{if(!nt.trim())return;await updateDoc(doc(db,'artifacts',appId,'users',user.uid,'todos',todo.id),{progress:[...(todo.progress||[]),{id:crypto.randomUUID(),text:nt,createdAt:Date.now()}]});setNt('');}} disabled={!nt.trim()} className="bg-indigo-600 disabled:bg-gray-300 text-white px-5 rounded-xl transition-colors"><Send size={18}/></button>
          </div>
        )}
      </div>
    </div>
  );
}

function CategoryManagerModal({categories, user, appId, db, onClose, showToast, reqConfirm}) {
  const [n, setN] = useState('');
  return (
    <div className="fixed inset-0 bg-gray-900/50 flex justify-center items-center z-50 p-4"><div className="bg-white rounded-3xl w-full max-w-sm shadow-2xl animate-scale-up"><div className="p-5 border-b flex justify-between"><h3 className="font-bold text-lg flex items-center gap-2"><Tags size={20}/> 分類管理</h3><button onClick={onClose}><X size={18}/></button></div><div className="p-3 max-h-[300px] overflow-y-auto custom-scrollbar">{categories.map(c=><div key={c.id} className="flex justify-between items-center p-3 bg-gray-50 border rounded-xl mb-1.5"><span className="text-sm font-bold">{c.name}</span><button onClick={()=>reqConfirm("刪除分類","確定刪除？",async()=>{await deleteDoc(doc(db,'artifacts',appId,'users',user.uid,'categories',c.id));})} className="text-gray-400 hover:text-red-500 bg-white p-1.5 rounded-lg border shadow-sm"><Trash2 size={14}/></button></div>)}</div><form onSubmit={async(e)=>{e.preventDefault();if(n.trim()){await setDoc(doc(collection(db,'artifacts',appId,'users',user.uid,'categories')),{name:n.trim(),createdAt:Date.now()});setN('');}}} className="p-4 border-t flex gap-2"><input value={n} onChange={e=>setN(e.target.value)} className="flex-1 border rounded-xl p-2.5 text-sm outline-none" placeholder="新分類名稱..."/><button className="bg-indigo-600 text-white px-5 rounded-xl font-bold">新增</button></form></div></div>
  );
}

const style = document.createElement('style');
style.textContent = `
  @keyframes slide-in-right { from { transform: translateX(100%); } to { transform: translateX(0); } }
  .animate-slide-in-right { animation: slide-in-right 0.3s cubic-bezier(0.16, 1, 0.3, 1); }
  @keyframes scale-up { from { transform: scale(0.95); opacity: 0; } to { transform: scale(1); opacity: 1; } }
  .animate-scale-up { animation: scale-up 0.2s cubic-bezier(0.16, 1, 0.3, 1); }
  @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
  .animate-fade-in { animation: fade-in 0.3s ease-out; }
  .hide-scrollbar::-webkit-scrollbar { display: none; }
  .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
  .custom-scrollbar::-webkit-scrollbar { width: 6px; height: 6px; }
  .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
  .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
  .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
  
  .rich-editor img {
    max-width: 100%; max-height: 400px; border-radius: 8px; margin: 10px 0; object-fit: contain;
    border: 1px solid #e5e7eb; box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  }
`;
document.head.appendChild(style);