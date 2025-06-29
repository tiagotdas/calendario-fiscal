import React, { useState, useEffect, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, onSnapshot, addDoc, doc, updateDoc, deleteDoc, setDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';

// --- ÍCONES SVG ---
const ChevronLeftIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6"><path d="m15 18-6-6 6-6" /></svg>
);
const ChevronRightIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6"><path d="m9 18 6-6-6-6" /></svg>
);
const EditIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
);
const TrashIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
);

// --- LÓGICA DE CONFIGURAÇÃO ROBUSTA DO FIREBASE ---
let firebaseConfig = {};
try {
    if (typeof __firebase_config !== 'undefined') {
        firebaseConfig = JSON.parse(__firebase_config);
    } else {
         console.warn("Variável global __firebase_config não encontrada.");
    }
} catch (e) { console.error("Não foi possível carregar a configuração do ambiente (__firebase_config)", e); }


const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

// Inicialização segura do Firebase
const app = firebaseConfig.apiKey ? initializeApp(firebaseConfig) : null;
const db = app ? getFirestore(app) : null;
const auth = app ? getAuth(app) : null;

// Caminhos do Firestore
const obligationsCollectionPath = `artifacts/${appId}/public/data/obligations`;
const subscribersCollectionPath = `artifacts/${appId}/public/data/subscribers`;


// --- COMPONENTE PRINCIPAL: App ---
export default function App() {
  const [obligations, setObligations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('calendar');
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
  const [firebaseError, setFirebaseError] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false); // Novo estado para rastrear o status da autenticação

  // Efeito 1: Lida com a Autenticação do Firebase
  useEffect(() => {
    if (!auth) {
        setFirebaseError("Falha na configuração do Firebase. Não foi possível conectar ao serviço de autenticação.");
        setIsAuthReady(true); // Permite que o app continue, exibindo um erro
        return;
    }

    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        try {
          await signInAnonymously(auth);
        } catch (error) {
          console.error("Erro na autenticação anônima:", error);
          setFirebaseError("Não foi possível autenticar com o serviço.");
        }
      }
      // Define a autenticação como pronta para que a busca de dados possa começar.
      setIsAuthReady(true);
    });

    return () => unsubscribeAuth(); // Limpa a inscrição ao desmontar o componente
  }, []); // O array de dependências vazio garante que isso execute apenas uma vez

  // Efeito 2: Lida com a Busca de Dados do Firestore, dependente da autenticação
  useEffect(() => {
    // Executa apenas se a autenticação estiver pronta e houver uma conexão com o banco de dados.
    if (isAuthReady) {
        if (!db) {
            setFirebaseError("Falha na configuração do Firebase. Não foi possível conectar ao banco de dados.");
            setLoading(false);
            setObligations(getMockObligations());
            return;
        }

        const obligationsRef = collection(db, obligationsCollectionPath);
        const unsubscribeFirestore = onSnapshot(obligationsRef, (snapshot) => {
            const fetchedObligations = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setObligations(fetchedObligations);
            setFirebaseError(null); // Limpa erros anteriores em caso de sucesso
            setLoading(false);
        }, (error) => {
            console.error("Erro ao buscar obrigações: ", error);
            // Fornece uma mensagem de erro mais específica.
            setFirebaseError("Não foi possível carregar os dados. Verifique as permissões de acesso ao banco de dados (Firestore Rules).");
            setObligations(getMockObligations()); 
            setLoading(false);
        });

        // Limpa o listener quando o componente é desmontado ou a dependência muda
        return () => unsubscribeFirestore();
    }
  }, [isAuthReady]); // Este efeito executa novamente se isAuthReady mudar

  const renderContent = () => {
    if (firebaseError && !loading) {
       return <PublicCalendarView obligations={obligations} loading={false} setView={setView} firebaseError={firebaseError} />;
    }

    if (view === 'admin' && isAdminAuthenticated) {
      return <AdminPanel obligations={obligations} setView={setView} />;
    }
    if (view === 'login') {
      return <LoginPanel setView={setView} setIsAdminAuthenticated={setIsAdminAuthenticated} />;
    }
    return <PublicCalendarView obligations={obligations} loading={loading} setView={setView} />;
  };

  return (
    <div className="bg-gray-100 min-h-screen font-sans">
        {renderContent()}
    </div>
  );
}

// --- VIEW PÚBLICA DO CALENDÁRIO ---
function PublicCalendarView({ obligations, loading, setView, firebaseError }) {
    const [currentDate, setCurrentDate] = useState(new Date());
    const [email, setEmail] = useState('');
    const [subscriptionStatus, setSubscriptionStatus] = useState({ loading: false, message: '', isError: false });

    const handleSubscription = async (e) => {
        e.preventDefault();
        if (!email || !email.includes('@')) {
            setSubscriptionStatus({ loading: false, message: 'Por favor, insira um e-mail válido.', isError: true });
            return;
        }
        setSubscriptionStatus({ loading: true, message: 'Inscrevendo...', isError: false });
        if (!db) {
            setSubscriptionStatus({ loading: false, message: 'Serviço indisponível. Tente novamente mais tarde.', isError: true });
            return;
        }
        try {
            const subscriberDocRef = doc(db, subscribersCollectionPath, email);
            await setDoc(subscriberDocRef, { email: email, subscribedAt: new Date() });
            setSubscriptionStatus({ loading: false, message: 'Inscrição realizada com sucesso!', isError: false });
            setEmail('');
        } catch (error) {
            console.error("Erro na inscrição:", error);
            setSubscriptionStatus({ loading: false, message: 'Ocorreu um erro. Tente novamente.', isError: true });
        }
    };

    return (
        <div className="p-4 md:p-8">
            <div className="max-w-7xl mx-auto bg-white rounded-2xl shadow-lg p-4 sm:p-6">
                 {firebaseError && (
                    <div className="bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700 p-4 mb-6 rounded-md" role="alert">
                      <p className="font-bold">Modo de Demonstração</p>
                      <p>{firebaseError} O site está exibindo dados de exemplo.</p>
                    </div>
                 )}
                <div className="text-center mb-6">
                    <h1 className="text-3xl md:text-4xl font-bold text-blue-800">Calendário Fiscal</h1>
                    <p className="text-gray-500 mt-2">Fique em dia com suas obrigações fiscais e tributárias.</p>
                </div>
                <Calendar currentDate={currentDate} onPrevMonth={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1))} onNextMonth={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1))} onGoToToday={() => setCurrentDate(new Date())} obligations={obligations} loading={loading} />
                <div className="mt-8 pt-6 border-t border-gray-200 text-center">
                    <h2 className="text-xl font-semibold text-gray-700">Receba Alertas por E-mail</h2>
                    <p className="text-gray-500 mt-2 mb-4 max-w-2xl mx-auto">Inscreva-se e receba um lembrete no dia anterior ao vencimento de cada obrigação.</p>
                    <form onSubmit={handleSubscription} className="flex flex-col items-center">
                         <div className="flex justify-center w-full max-w-lg">
                             <input type="email" placeholder="seu_melhor_email@exemplo.com" value={email} onChange={(e) => setEmail(e.target.value)} disabled={subscriptionStatus.loading} className="w-full max-w-sm px-4 py-3 rounded-l-lg border-2 border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 transition disabled:bg-gray-200"/>
                             <button type="submit" disabled={subscriptionStatus.loading || !!firebaseError} className="bg-blue-600 text-white font-bold px-6 py-3 rounded-r-lg hover:bg-blue-700 transition-colors duration-300 disabled:bg-gray-400 disabled:cursor-not-allowed">
                                {subscriptionStatus.loading ? '...' : 'Inscrever'}
                             </button>
                         </div>
                         {subscriptionStatus.message && (
                            <p className={`mt-3 text-sm ${subscriptionStatus.isError ? 'text-red-500' : 'text-green-600'}`}>{subscriptionStatus.message}</p>
                         )}
                    </form>
                </div>
            </div>
            <footer className="text-center mt-8 text-gray-400 text-sm">
                <p>Desenvolvido com Gemini.</p>
                <button onClick={() => setView('login')} className="text-blue-500 hover:underline mt-2">Acesso Restrito</button>
            </footer>
        </div>
    );
}

// --- VIEW DE LOGIN DO ADMIN ---
function LoginPanel({ setView, setIsAdminAuthenticated }) {
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const handleLogin = (e) => { e.preventDefault(); if (password === 'admin123') { setIsAdminAuthenticated(true); setView('admin'); setError(''); } else { setError('Senha incorreta.'); } };
    return (<div className="flex flex-col items-center justify-center min-h-screen p-4"><div className="w-full max-w-md bg-white rounded-2xl shadow-lg p-8"><h1 className="text-2xl font-bold text-center text-blue-800 mb-6">Acesso Administrativo</h1><form onSubmit={handleLogin}><div className="mb-4"><label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="password">Senha</label><input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full px-4 py-3 rounded-lg border-2 border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="********"/></div>{error && <p className="text-red-500 text-xs italic mb-4">{error}</p>}<button type="submit" className="w-full bg-blue-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-blue-700">Entrar</button></form><button onClick={() => setView('calendar')} className="w-full text-center mt-6 text-sm text-blue-500 hover:underline">Voltar</button></div></div>);
}

// --- VIEW DO PAINEL DE ADMINISTRAÇÃO COM MODAL DE CONFIRMAÇÃO ---
function AdminPanel({ obligations, setView }) {
    const [formData, setFormData] = useState({ title: '', date: '', sphere: 'Federal' });
    const [editingId, setEditingId] = useState(null);
    const [showConfirmModal, setShowConfirmModal] = useState(null);

    const handleEditClick = (obligation) => { setFormData({ title: obligation.title, date: obligation.date, sphere: obligation.sphere }); setEditingId(obligation.id); window.scrollTo(0, 0); };
    const cancelEdit = () => { setFormData({ title: '', date: '', sphere: 'Federal' }); setEditingId(null); };
    
    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!db) { alert("Serviço indisponível."); return; }
        if (!formData.title || !formData.date) { return; }
        try {
            const obligationsRef = collection(db, obligationsCollectionPath);
            if (editingId) {
                const docRef = doc(obligationsRef, editingId);
                await updateDoc(docRef, formData);
            } else {
                await addDoc(obligationsRef, formData);
            }
            cancelEdit();
        } catch (error) { console.error("Erro ao salvar:", error); }
    };
    
    const handleDeleteClick = (id) => { setShowConfirmModal(id); };

    const confirmDelete = async () => {
        if (!db || !showConfirmModal) { return; }
        try {
            const docRef = doc(db, obligationsCollectionPath, showConfirmModal);
            await deleteDoc(docRef);
            setShowConfirmModal(null);
        } catch (error) { console.error("Erro ao excluir:", error); }
    };

    return (
        <>
            <div className="p-4 md:p-8">
                <div className="max-w-4xl mx-auto bg-white rounded-2xl shadow-lg p-6">
                    <div className="flex justify-between items-center mb-6 border-b pb-4"><h1 className="text-2xl font-bold text-blue-800">Painel de Controle</h1><button onClick={() => setView('calendar')} className="text-sm text-blue-500 hover:underline">Ver Calendário</button></div>
                    <div className="bg-gray-50 p-6 rounded-lg mb-8"><h2 className="text-xl font-semibold text-gray-700 mb-4">{editingId ? "Editando Obrigação" : "Adicionar Nova Obrigação"}</h2><form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-3 gap-4"><div className="md:col-span-2"><label htmlFor="title" className="block text-sm font-medium text-gray-600">Título</label><input type="text" id="title" value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} className="mt-1 w-full px-3 py-2 border rounded-md shadow-sm"/></div><div><label htmlFor="date" className="block text-sm font-medium text-gray-600">Vencimento</label><input type="date" id="date" value={formData.date} onChange={e => setFormData({...formData, date: e.target.value})} className="mt-1 w-full px-3 py-2 border rounded-md shadow-sm"/></div><div><label htmlFor="sphere" className="block text-sm font-medium text-gray-600">Esfera</label><select id="sphere" value={formData.sphere} onChange={e => setFormData({...formData, sphere: e.target.value})} className="mt-1 w-full px-3 py-2 border rounded-md shadow-sm bg-white"><option>Federal</option><option>Estadual</option><option>Municipal</option></select></div><div className="md:col-span-3 flex items-center justify-end space-x-3 mt-2">{editingId && <button type="button" onClick={cancelEdit} className="px-4 py-2 bg-gray-500 text-white font-semibold rounded-lg hover:bg-gray-600">Cancelar</button>}<button type="submit" className="px-6 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700">{editingId ? 'Atualizar' : 'Adicionar'}</button></div></form></div>
                    <div><h2 className="text-xl font-semibold text-gray-700 mb-4">Obrigações Cadastradas</h2><div className="space-y-3">{obligations.length > 0 ? obligations.map(ob => (<div key={ob.id} className="flex items-center justify-between bg-white p-3 rounded-lg border shadow-sm"><div><p className="font-bold">{ob.title}</p><p className="text-sm text-gray-500">{new Date(ob.date + 'T00:00:00').toLocaleDateString('pt-BR')} - <span className={`font-semibold ${getSphereTextColor(ob.sphere)}`}>{ob.sphere}</span></p></div><div className="flex items-center space-x-3"><button onClick={() => handleEditClick(ob)} className="p-2 text-blue-600"><EditIcon/></button><button onClick={() => handleDeleteClick(ob.id)} className="p-2 text-red-500"><TrashIcon/></button></div></div>)) : <p className="text-center text-gray-500 py-4">Nenhuma obrigação cadastrada.</p>}</div></div>
                </div>
            </div>
            {showConfirmModal && <ConfirmModal message="Tem certeza que deseja excluir esta obrigação? A ação não pode ser desfeita." onConfirm={confirmDelete} onCancel={() => setShowConfirmModal(null)} />}
        </>
    );
}

// --- COMPONENTE DO CALENDÁRIO ---
function Calendar({ currentDate, onPrevMonth, onNextMonth, onGoToToday, obligations, loading }) {
  const monthName = currentDate.toLocaleString('pt-BR', { month: 'long' });
  const year = currentDate.getFullYear();
  const calendarDays = useMemo(() => { const days = []; const firstDayOfMonth = new Date(year, currentDate.getMonth(), 1); const lastDayOfMonth = new Date(year, currentDate.getMonth() + 1, 0); const startDayOfWeek = firstDayOfMonth.getDay(); const totalDaysInMonth = lastDayOfMonth.getDate(); const lastDayOfPrevMonth = new Date(year, currentDate.getMonth(), 0).getDate(); for (let i = startDayOfWeek - 1; i >= 0; i--) { days.push({ date: new Date(year, currentDate.getMonth() - 1, lastDayOfPrevMonth - i), isCurrentMonth: false }); } for (let i = 1; i <= totalDaysInMonth; i++) { const date = new Date(year, currentDate.getMonth(), i); const dateString = `${year}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`; days.push({ date: date, isCurrentMonth: true, isToday: date.toDateString() === new Date().toDateString(), obligations: obligations.filter(o => o.date === dateString) }); } const remainingDays = (7 - (days.length % 7)) % 7; for (let i = 1; i <= remainingDays; i++) { days.push({ date: new Date(year, currentDate.getMonth() + 1, i), isCurrentMonth: false }) } return days; }, [currentDate, obligations, year]);
  const weekDays = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  return (
    <div className="w-full">
        <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-2">
                <button onClick={onGoToToday} className="px-4 py-2 text-sm font-semibold text-gray-600 border rounded-lg hover:bg-gray-100">Hoje</button>
                <div className="flex items-center rounded-lg border">
                    <button onClick={onPrevMonth} className="p-2 text-gray-600 hover:bg-gray-100 rounded-l-md"><ChevronLeftIcon /></button>
                    <button onClick={onNextMonth} className="p-2 text-gray-600 border-l hover:bg-gray-100 rounded-r-md"><ChevronRightIcon /></button>
                </div>
            </div>
            <h2 className="text-xl md:text-2xl font-semibold capitalize w-48 text-center">{monthName} {year}</h2>
            <div className="w-48"></div>
        </div>
        <div className="grid grid-cols-7 border-t border-l">
            {weekDays.map(day => (
                <div key={day} className="text-center font-semibold text-xs sm:text-sm text-gray-500 py-3 bg-gray-50 border-b border-r">{day}</div>
            ))}
            {loading ? (
                <div className="col-span-7 h-96 flex items-center justify-center"><p>Carregando...</p></div>
            ) : (
                calendarDays.map((day, index) => (
                    <div key={index} className={`relative min-h-[120px] sm:min-h-[140px] p-2 border-b border-r ${day.isCurrentMonth ? 'bg-white hover:bg-gray-50' : 'bg-gray-50 text-gray-400'}`}>
                        <span className={`text-sm font-semibold ${day.isToday ? 'bg-blue-600 text-white rounded-full flex items-center justify-center h-7 w-7' : ''}`}>{day.date.getDate()}</span>
                        <div className="mt-1 space-y-1">
                            {day.obligations?.map(ob => (
                                <div key={ob.id} className={`text-xs p-1 rounded-md text-white ${getSphereColor(ob.sphere)}`}>{ob.title}</div>
                            ))}
                        </div>
                    </div>
                ))
            )}
        </div>
    </div>
  );
}

// --- NOVO COMPONENTE: MODAL DE CONFIRMAÇÃO ---
function ConfirmModal({ message, onConfirm, onCancel }) {
    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
            <div className="bg-white rounded-lg shadow-lg p-6 m-4 max-w-sm w-full">
                <p className="text-gray-800 text-lg mb-4">{message}</p>
                <div className="flex justify-end space-x-4">
                    <button onClick={onCancel} className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300">
                        Cancelar
                    </button>
                    <button onClick={onConfirm} className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700">
                        Confirmar Exclusão
                    </button>
                </div>
            </div>
        </div>
    );
}

// --- FUNÇÕES AUXILIARES ---
function getSphereColor(sphere = '') { switch (sphere.toLowerCase()) { case 'federal': return 'bg-blue-500'; case 'estadual': return 'bg-green-500'; case 'municipal': return 'bg-yellow-500'; default: return 'bg-gray-500'; } }
function getSphereTextColor(sphere = '') { switch (sphere.toLowerCase()) { case 'federal': return 'text-blue-600'; case 'estadual': return 'text-green-600'; case 'municipal': return 'text-yellow-600'; default: return 'text-gray-600'; } }
function getMockObligations() { const today = new Date(); const year = today.getFullYear(); const month = String(today.getMonth() + 1).padStart(2, '0'); return [ { id: '1', date: `${year}-${month}-10`, title: 'DCTFWeb', sphere: 'Federal' }, { id: '2', date: `${year}-${month}-20`, title: 'GPS', sphere: 'Federal' }, { id: '3', date: `${year}-${month}-07`, title: 'Simples Nacional', sphere: 'Federal' }, ]; }
