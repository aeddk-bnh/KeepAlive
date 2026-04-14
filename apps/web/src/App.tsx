import React, { useState, useEffect, useMemo } from 'react';

const API_URL = 'http://3.0.17.234:3001/api';

// --- Types ---
interface ActivityLog {
  id: string;
  level: 'INFO' | 'WARN' | 'ERROR';
  message: string;
  timestamp: string;
}

interface Target {
  id: string;
  url: string;
  refreshInterval: number;
  isActive: boolean;
  status: 'ACTIVE' | 'EXPIRED' | 'ERROR' | 'IDLE' | 'LOADING';
  lastRun?: string;
  logs: ActivityLog[];
}

interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info';
}

interface ContextMenuPos {
  x: number;
  y: number;
  targetId: string;
}

// --- Icons ---
const IconPlus = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 6v6m0 0v6m0-6h6m-6 0H6"/></svg>;
const IconTrash = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>;
const IconPause = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>;
const IconPlay = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>;
const IconX = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12"/></svg>;
const IconMore = () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 5v.01M12 12v.01M12 19v.01"/></svg>;
const IconCamera = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"/></svg>;
const IconRefresh = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>;
const IconKey = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"/></svg>;

// --- Toast Component ---
const ToastContainer = ({ toasts, removeToast }: { toasts: Toast[], removeToast: (id: number) => void }) => (
  <div className="fixed bottom-6 right-6 z-[200] space-y-3 pointer-events-none">
    {toasts.map(toast => (
      <div key={toast.id} className={`pointer-events-auto flex items-center gap-3 px-5 py-3 rounded-xl shadow-2xl border transition-all duration-300 animate-in slide-in-from-right-10 ${
        toast.type === 'success' ? 'bg-emerald-600 border-emerald-500 text-white' :
        toast.type === 'error' ? 'bg-rose-600 border-rose-500 text-white' :
        'bg-slate-900 border-slate-800 text-white'
      }`}>
        <span className="font-bold text-xs uppercase tracking-widest">{toast.message}</span>
        <button onClick={() => removeToast(toast.id)} className="opacity-50 hover:opacity-100 transition-opacity"><IconX /></button>
      </div>
    ))}
  </div>
);

// --- Context Menu Component ---
const ContextMenu = ({ pos, target, actions, onClose }: { pos: ContextMenuPos; target: Target; actions: { label: string; icon: React.ReactNode; action: () => void; color?: string }[]; onClose: () => void }) => (
  <div
    className="fixed z-[160] bg-white/95 backdrop-blur-md rounded-xl shadow-2xl border border-slate-100 w-48 py-1.5 animate-in zoom-in-95 fade-in duration-150"
    style={{ top: pos.y, left: pos.x }}
    onClick={(e) => e.stopPropagation()}
  >
    <div className="px-3 py-2 border-b border-slate-100">
      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest truncate">{target.url.replace(/^https?:\/\//, '')}</p>
    </div>
    {actions.map((item, i) => (
      <button
        key={i}
        onClick={() => { item.action(); onClose(); }}
        className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-bold transition-colors ${item.color || 'text-slate-600 hover:bg-slate-50'}`}
      >
        {item.icon}
        {item.label}
      </button>
    ))}
  </div>
);

export default function App() {
  const [targets, setTargets] = useState<Target[]>([]);

  // Modal States
  const [showAddModal, setShowAddModal] = useState(false);
  const [showRenewModal, setShowRenewModal] = useState(false);
  const [showScreenshotModal, setShowScreenshotModal] = useState(false);

  // Interaction States
  const [screenshotImage, setScreenshotImage] = useState<string | null>(null);
  const [screenshotLoading, setScreenshotLoading] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [contextMenu, setContextMenu] = useState<ContextMenuPos | null>(null);

  // Form States
  const [newTarget, setNewTarget] = useState({ url: '', cookies: '', refreshInterval: 60 });
  const [renewData, setRenewData] = useState({ targetId: '', cookies: '' });

  const showToast = (message: string, type: Toast['type'] = 'info') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => removeToast(id), 5000);
  };

  const removeToast = (id: number) => setToasts(prev => prev.filter(t => t.id !== id));

  const fetchData = async () => {
    try {
      const tRes = await fetch(`${API_URL}/targets`);
      if (tRes.ok) setTargets(await tRes.json());
    } catch (err) {
      console.error('Error fetching data:', err);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const handler = () => setContextMenu(null);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  const validateJsonArray = (str: string) => {
    try {
      const parsed = JSON.parse(str);
      if (!Array.isArray(parsed)) return false;
      return true;
    } catch(e) {
      return false;
    }
  }

  const addTarget = async () => {
    if (!newTarget.url || !newTarget.cookies) {
      return showToast('Please fill URL and Cookies', 'error');
    }
    if (!validateJsonArray(newTarget.cookies)) {
      return showToast('Cookies must be a valid JSON array', 'error');
    }

    const response = await fetch(`${API_URL}/targets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newTarget)
    });

    if (response.ok) {
      showToast('Target Added', 'success');
      setShowAddModal(false);
      setNewTarget({ url: '', cookies: '', refreshInterval: 60 });
      fetchData();
    } else {
      showToast('Failed to add target', 'error');
    }
  };

  const renewSession = async () => {
    if (!renewData.cookies) return showToast('Please paste new cookies', 'error');
    if (!validateJsonArray(renewData.cookies)) return showToast('Invalid JSON format', 'error');

    const response = await fetch(`${API_URL}/targets/${renewData.targetId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cookies: renewData.cookies, status: 'IDLE', isActive: true, lastRun: null })
    });

    if (response.ok) {
      showToast('Session Renewed', 'success');
      setShowRenewModal(false);
      setRenewData({ targetId: '', cookies: '' });
      fetchData();
    } else {
      showToast('Failed to renew session', 'error');
    }
  };

  const toggleTarget = async (id: string, currentStatus: boolean) => {
    const response = await fetch(`${API_URL}/targets/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !currentStatus })
    });
    if (response.ok) {
      showToast(currentStatus ? 'Paused' : 'Active', 'info');
      fetchData();
    }
  };

  const deleteTarget = async (id: string) => {
    const response = await fetch(`${API_URL}/targets/${id}`, { method: 'DELETE' });
    if (response.ok) {
      showToast('Deleted', 'success');
      fetchData();
    }
  };

  const takeScreenshot = async (targetId: string) => {
    setScreenshotLoading(true);
    setScreenshotImage(null);
    setShowScreenshotModal(true);
    try {
      const response = await fetch(`${API_URL}/targets/${targetId}/screenshot`, { method: 'POST' });
      if (response.ok) {
        const data = await response.json();
        setScreenshotImage(data.image);
        showToast('Screenshot captured', 'success');
      } else {
        const err = await response.json();
        showToast(err.error || 'Screenshot failed', 'error');
      }
    } catch (err) {
      showToast('Network error', 'error');
    } finally {
      setScreenshotLoading(false);
    }
  };

  const refreshTarget = async (targetId: string) => {
    showToast('Refreshing...', 'info');
    await fetch(`${API_URL}/targets/${targetId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'IDLE', lastRun: null })
    });
    fetchData();
  };

  const openContextMenu = (e: React.MouseEvent, targetId: string) => {
    e.stopPropagation();
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, targetId });
  };

  const stats = useMemo(() => ({
    total: targets.length,
    active: targets.filter(t => t.status === 'ACTIVE' && t.isActive).length,
    expired: targets.filter(t => t.status === 'EXPIRED').length,
    errors: targets.filter(t => t.status === 'ERROR').length
  }), [targets]);

  const getContextActions = (target: Target) => {
    return [
      {
        label: 'Renew Session',
        icon: <IconKey />,
        action: () => { setRenewData({ targetId: target.id, cookies: '' }); setShowRenewModal(true); },
        color: 'text-indigo-600 hover:bg-indigo-50'
      },
      {
        label: 'Screenshot',
        icon: <IconCamera />,
        action: () => takeScreenshot(target.id),
        color: 'text-slate-600 hover:bg-slate-50'
      },
      {
        label: 'Force Refresh',
        icon: <IconRefresh />,
        action: () => refreshTarget(target.id),
        color: 'text-emerald-600 hover:bg-emerald-50'
      },
      {
        label: target.isActive ? 'Pause Monitor' : 'Resume Monitor',
        icon: target.isActive ? <IconPause /> : <IconPlay />,
        action: () => toggleTarget(target.id, target.isActive),
        color: 'text-amber-600 hover:bg-amber-50'
      },
      {
        label: 'Delete Target',
        icon: <IconTrash />,
        action: () => deleteTarget(target.id),
        color: 'text-rose-600 hover:bg-rose-50'
      }
    ];
  };

  return (
    <div className="min-h-screen bg-[#F4F6F9] text-slate-900 font-sans selection:bg-indigo-100 pb-20 overflow-x-hidden">
      <ToastContainer toasts={toasts} removeToast={removeToast} />

      {/* Context Menu Overlay */}
      {contextMenu && (() => {
        const target = targets.find(t => t.id === contextMenu.targetId);
        if (!target) return null;
        return <ContextMenu pos={contextMenu} target={target} actions={getContextActions(target)} onClose={() => setContextMenu(null)} />;
      })()}

      {/* Main Container */}
      <div className="max-w-[1280px] mx-auto px-8 pt-12">

        {/* Bento Header */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-12">
          {/* Logo & Branding Box */}
          <div className="lg:col-span-2 bg-gradient-to-br from-indigo-600 to-violet-600 rounded-[2rem] p-8 shadow-xl shadow-indigo-200/60 border border-white/20 flex flex-col justify-between group overflow-hidden relative">
            <div className="absolute top-0 right-0 w-40 h-40 bg-white/10 rounded-full -mr-16 -mt-16 group-hover:scale-110 transition-transform duration-700 blur-2xl"></div>
            <div className="relative z-10">
              <div className="w-12 h-12 bg-white/20 backdrop-blur-sm rounded-xl flex items-center justify-center shadow-lg mb-6 transform group-hover:rotate-6 transition-transform border border-white/20">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
              </div>
              <h1 className="text-4xl font-black tracking-tighter text-white mb-2">KeepAlive<span className="text-indigo-200">.</span></h1>
              <p className="text-indigo-100 font-bold text-xs uppercase tracking-[0.2em]">Unified Session Engine</p>
            </div>
            <div className="flex gap-3 mt-10 relative z-10">
              <button onClick={() => setShowAddModal(true)} className="px-6 py-3 bg-white text-indigo-600 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-indigo-50 transition-all shadow-xl active:scale-95 flex items-center gap-2">
                <IconPlus /> Add Target
              </button>
            </div>
          </div>

          {/* Stats Bento Blocks */}
          <div className="grid grid-cols-2 gap-6 lg:col-span-2">
            <div className="bg-white rounded-[2rem] p-6 shadow-[0_8px_30px_rgb(0,0,0,0.03)] border border-white flex flex-col justify-center items-center group hover:border-emerald-200 transition-all relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-emerald-50 to-teal-50 opacity-0 group-hover:opacity-100 transition-opacity"></div>
              <div className="relative z-10 flex flex-col items-center">
                <div className="w-8 h-8 bg-emerald-100 text-emerald-600 rounded-lg flex items-center justify-center mb-3 group-hover:scale-110 transition-transform shadow-sm"><IconPlay /></div>
                <p className="text-3xl font-black text-slate-800 leading-none mb-1">{stats.active}</p>
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Active Links</p>
              </div>
            </div>
            <div className="bg-white rounded-[2rem] p-6 shadow-[0_8px_30px_rgb(0,0,0,0.03)] border border-white flex flex-col justify-center items-center group hover:border-rose-200 transition-all relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-rose-50 to-pink-50 opacity-0 group-hover:opacity-100 transition-opacity"></div>
              <div className="relative z-10 flex flex-col items-center">
                <div className="w-8 h-8 bg-rose-100 text-rose-600 rounded-lg flex items-center justify-center mb-3 group-hover:scale-110 transition-transform shadow-sm"><IconPause /></div>
                <p className="text-3xl font-black text-slate-800 leading-none mb-1">{stats.expired}</p>
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Expired Sessions</p>
              </div>
            </div>
            <div className="bg-white rounded-[2rem] p-6 shadow-[0_8px_30px_rgb(0,0,0,0.03)] border border-white flex flex-col justify-center items-center group hover:border-amber-200 transition-all relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-amber-50 to-orange-50 opacity-0 group-hover:opacity-100 transition-opacity"></div>
              <div className="relative z-10 flex flex-col items-center">
                <div className="w-8 h-8 bg-amber-100 text-amber-600 rounded-lg flex items-center justify-center mb-3 group-hover:scale-110 transition-transform shadow-sm"><IconRefresh /></div>
                <p className="text-3xl font-black text-slate-800 leading-none mb-1">{stats.errors}</p>
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Errors</p>
              </div>
            </div>
            <div className="bg-slate-900 rounded-[2rem] p-6 shadow-xl flex flex-col justify-center items-center group ring-8 ring-slate-200/50 relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-slate-800 to-slate-950"></div>
              <div className="relative z-10 flex flex-col items-center">
                <p className="text-4xl font-black text-white leading-none mb-2">{stats.total}</p>
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Total Targets</p>
              </div>
            </div>
          </div>
        </div>

        {/* Content Section */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {targets.map(target => (
            <div
              key={target.id}
              onContextMenu={(e) => openContextMenu(e, target.id)}
              className={`bg-white rounded-[2rem] p-8 shadow-[0_8px_30px_rgb(0,0,0,0.03)] border ${target.status === 'EXPIRED' ? 'border-rose-200 ring-4 ring-rose-100' : 'border-white'} hover:shadow-2xl hover:-translate-y-1.5 transition-all duration-500 group flex flex-col cursor-context-menu`}
            >
              <div className="flex justify-between items-start mb-6">
                <div className={`px-3 py-1.5 rounded-lg text-[9px] font-black tracking-widest uppercase border shadow-sm ${
                  !target.isActive ? 'bg-slate-50 text-slate-400 border-slate-100' :
                  target.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' :
                  target.status === 'EXPIRED' ? 'bg-rose-50 text-rose-600 border-rose-100 animate-pulse' :
                  target.status === 'LOADING' ? 'bg-sky-50 text-sky-600 border-sky-100 animate-pulse' :
                  'bg-amber-50 text-amber-600 border-amber-100'
                }`}>
                  {!target.isActive ? 'Paused' : target.status}
                </div>
                <div className="flex items-center gap-1.5">
                  {target.status === 'EXPIRED' && (
                    <button onClick={() => { setRenewData({ targetId: target.id, cookies: '' }); setShowRenewModal(true); }} className="px-3 py-1.5 bg-indigo-50 text-indigo-600 hover:bg-indigo-600 hover:text-white rounded-lg text-[9px] font-black uppercase tracking-widest transition-colors animate-bounce">
                      Renew
                    </button>
                  )}
                  <button
                    onClick={(e) => openContextMenu(e, target.id)}
                    className="p-1.5 text-slate-300 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                  >
                    <IconMore />
                  </button>
                </div>
              </div>

              <div className="flex-1 mb-6">
                <h3 className="text-xl font-black text-slate-800 break-all line-clamp-2 leading-tight mb-2 group-hover:text-indigo-600 transition-colors" title={target.url}>
                  {target.url.replace(/^https?:\/\/(www\.)?/, '')}
                </h3>
              </div>

              <div className="bg-slate-50/50 rounded-2xl p-4 border border-slate-100 space-y-3">
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest flex justify-between">
                  Last Activity <span className="text-indigo-600">{target.lastRun ? new Date(target.lastRun).toLocaleTimeString() : 'N/A'}</span>
                </p>
                <div className="space-y-2">
                  {target.logs?.slice(0, 2).map((log: any) => (
                    <div key={log.id} className={`text-[10px] font-bold p-2 rounded-lg border ${
                      log.level === 'ERROR' ? 'bg-rose-50 border-rose-100 text-rose-500' : 'bg-white border-slate-100 text-slate-500'
                    }`}>
                      {log.message}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
          {targets.length === 0 && (
             <div className="col-span-full py-20 bg-white rounded-3xl border-2 border-dashed border-slate-200 flex flex-col items-center justify-center text-slate-400">
               <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-4"><IconPlus /></div>
               <p className="text-lg font-black text-slate-500">No targets monitored</p>
               <p className="text-xs font-bold mt-1 uppercase tracking-widest">Click 'Add Target' to begin</p>
            </div>
          )}
        </div>

        {/* Screenshot Modal */}
        {showScreenshotModal && (
          <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-md flex items-center justify-center p-6 z-[150] animate-in fade-in duration-300">
            <div className="bg-white/95 rounded-[2.5rem] shadow-[0_32px_120px_rgba(0,0,0,0.25)] p-8 w-full max-w-4xl border border-white/50 transform animate-in zoom-in-95 duration-300 relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-indigo-600 via-violet-500 to-fuchsia-500"></div>
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-black tracking-tight text-slate-800 flex items-center gap-3">
                  <IconCamera /> Live Screenshot
                </h2>
                <button onClick={() => { setShowScreenshotModal(false); setScreenshotImage(null); }} className="w-10 h-10 flex items-center justify-center bg-slate-50 rounded-xl text-slate-400 hover:text-rose-500 hover:bg-rose-50 transition-all"><IconX /></button>
              </div>
              <div className="rounded-2xl overflow-hidden bg-slate-100 border border-slate-200 min-h-[400px] flex items-center justify-center">
                {screenshotLoading ? (
                  <div className="flex flex-col items-center gap-4 py-20">
                    <div className="w-12 h-12 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
                    <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">Capturing page...</p>
                  </div>
                ) : screenshotImage ? (
                  <img src={`data:image/jpeg;base64,${screenshotImage}`} alt="Screenshot" className="w-full h-auto max-h-[70vh] object-contain" />
                ) : (
                  <p className="text-sm font-bold text-slate-400">Failed to capture</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Modal Add Target */}
        {showAddModal && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-6 z-[150] animate-in fade-in duration-300">
            <div className="bg-white/95 rounded-[2.5rem] shadow-[0_32px_120px_rgba(0,0,0,0.25)] p-10 w-full max-w-2xl border border-white/50 transform animate-in zoom-in-95 duration-300 relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-indigo-600 via-violet-500 to-fuchsia-500"></div>
              <div className="flex justify-between items-center mb-8">
                <div>
                  <h2 className="text-3xl font-black tracking-tight text-slate-800">Add Target</h2>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mt-1">URL & Cookies Combined</p>
                </div>
                <button onClick={() => setShowAddModal(false)} className="w-10 h-10 flex items-center justify-center bg-slate-50 rounded-xl text-slate-400 hover:text-rose-500 hover:bg-rose-50 transition-all"><IconX /></button>
              </div>

              <div className="space-y-6">
                <div>
                  <label className="block text-[9px] font-black text-slate-400 uppercase tracking-[0.3em] mb-2">Website URL</label>
                  <input type="text" className="w-full bg-slate-50 border-2 border-slate-100 rounded-xl px-5 py-3.5 focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 transition-all outline-none font-bold text-slate-700" placeholder="https://facebook.com/..." onChange={e => setNewTarget({...newTarget, url: e.target.value})} />
                </div>
                <div>
                  <label className="block text-[9px] font-black text-slate-400 uppercase tracking-[0.3em] mb-2 flex justify-between">
                    <span>Cookie JSON Array</span>
                    <span className="text-indigo-400">Paste directly from EditThisCookie</span>
                  </label>
                  <textarea
                    className="w-full bg-slate-50 border-2 border-slate-100 rounded-xl px-5 py-3.5 focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 transition-all outline-none font-mono text-xs text-slate-700 h-32 resize-none"
                    placeholder='[{"domain": ".facebook.com", "name": "c_user", ...}]'
                    onChange={e => setNewTarget({...newTarget, cookies: e.target.value})}
                  />
                </div>
              </div>

              <div className="mt-8 flex gap-3">
                <button onClick={() => setShowAddModal(false)} className="flex-1 py-3.5 bg-slate-100 text-slate-400 rounded-xl font-bold text-[10px] uppercase tracking-widest hover:bg-slate-200 transition-all">Cancel</button>
                <button onClick={addTarget} className="flex-[2] py-3.5 bg-gradient-to-r from-indigo-600 to-violet-600 text-white rounded-xl font-bold text-[10px] uppercase tracking-widest shadow-lg shadow-indigo-200 hover:shadow-xl hover:scale-[1.02] transition-all">Start Monitoring</button>
              </div>
            </div>
          </div>
        )}

        {/* Modal Renew Session */}
        {showRenewModal && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-6 z-[150] animate-in fade-in duration-300">
            <div className="bg-white/95 rounded-[2.5rem] shadow-[0_32px_120px_rgba(0,0,0,0.25)] p-10 w-full max-w-xl border border-white/50 transform animate-in zoom-in-95 duration-300 relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-indigo-600 via-violet-500 to-fuchsia-500"></div>
              <div className="flex justify-between items-center mb-8">
                <div>
                  <h2 className="text-3xl font-black tracking-tight text-slate-800">Renew Session</h2>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mt-1">Update Cookies for Target</p>
                </div>
                <button onClick={() => setShowRenewModal(false)} className="w-10 h-10 flex items-center justify-center bg-slate-50 rounded-xl text-slate-400 hover:text-rose-500 hover:bg-rose-50 transition-all"><IconX /></button>
              </div>

              <div className="space-y-6">
                <div>
                  <label className="block text-[9px] font-black text-slate-400 uppercase tracking-[0.3em] mb-2">Paste New Cookie JSON</label>
                  <textarea
                    className="w-full bg-slate-50 border-2 border-slate-100 rounded-xl px-5 py-3.5 focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 transition-all outline-none font-mono text-xs text-slate-700 h-40 resize-none"
                    placeholder='[{"domain": ".facebook.com", "name": "c_user", ...}]'
                    onChange={e => setRenewData({...renewData, cookies: e.target.value})}
                  />
                </div>
              </div>

              <div className="mt-8 flex gap-3">
                <button onClick={() => setShowRenewModal(false)} className="flex-1 py-3.5 bg-slate-100 text-slate-400 rounded-xl font-bold text-[10px] uppercase tracking-widest hover:bg-slate-200 transition-all">Cancel</button>
                <button onClick={renewSession} className="flex-[2] py-3.5 bg-gradient-to-r from-emerald-500 to-teal-500 text-white rounded-xl font-bold text-[10px] uppercase tracking-widest shadow-lg shadow-emerald-200 hover:shadow-xl hover:scale-[1.02] transition-all">Renew & Resume</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
