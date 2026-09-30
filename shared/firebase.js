// Inicialização do Firebase (SDK modular carregado do CDN oficial, sem build).
// Ao trocar a versão, atualize também a lista de arquivos em campo/sw.js.
import { initializeApp, deleteApp } from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut,
  createUserWithEmailAndPassword, sendPasswordResetEmail,
} from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js';
import { initializeFirestore, doc, getDoc } from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

export * from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js';
export { onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail };

export const configured = !!firebaseConfig.projectId && !String(firebaseConfig.apiKey).startsWith('COLE');
export const app = configured ? initializeApp(firebaseConfig) : null;
export const auth = app ? getAuth(app) : null;
export const fs = app ? initializeFirestore(app, { ignoreUndefinedProperties: true }) : null;

export function assertConfigured() {
  if (!configured) throw new Error('Firebase não configurado. Preencha shared/firebase-config.js (veja FIREBASE.md).');
}

// Resolve quando o Firebase termina de restaurar a sessão salva no aparelho.
export async function currentUser() {
  assertConfigured();
  await auth.authStateReady();
  return auth.currentUser;
}

export async function getProfile(uid) {
  const snap = await getDoc(doc(fs, 'users', uid));
  return snap.exists() ? { uid, ...snap.data() } : null;
}

// Confere o documento users/{uid} do mesmo jeito que as regras do Firestore (tipos exatos).
export function profileProblem(p, role) {
  if (!p) return 'Usuário sem cadastro na coleção "users". Procure o administrador.';
  if (typeof p.active !== 'boolean') {
    return `Cadastro com erro: o campo "active" está como ${typeof p.active} ("${p.active}"), mas precisa ser do tipo boolean. ` +
      'Corrija no Firebase Console → Firestore → users.';
  }
  if (!p.active) return 'Seu usuário está desativado. Procure o administrador.';
  if (p.role !== role) {
    return role === 'admin'
      ? 'Esta conta não tem acesso de administrador (campo "role" precisa ser "admin").'
      : 'Esta conta é de administrador. Use o painel admin ou peça uma conta de orientador.';
  }
  return null;
}

export const AUTH_ERRORS = {
  'auth/invalid-credential': 'E-mail ou senha incorretos.',
  'auth/invalid-email': 'E-mail inválido.',
  'auth/user-disabled': 'Usuário desativado.',
  'auth/too-many-requests': 'Muitas tentativas. Aguarde alguns minutos.',
  'auth/network-request-failed': 'Sem conexão com a internet.',
  'auth/email-already-in-use': 'Já existe uma conta com este e-mail.',
  'auth/weak-password': 'A senha precisa ter pelo menos 6 caracteres.',
  'permission-denied': 'Sem permissão. Verifique se o usuário está ativo e as regras do Firestore foram publicadas.',
  'unavailable': 'Servidor indisponível ou sem conexão.',
};
export const errorMessage = (err) => AUTH_ERRORS[err?.code] || err?.message || String(err);

// Cria uma conta sem derrubar a sessão do admin (usa uma instância secundária do app).
export async function createAccount(email, password) {
  const secondary = initializeApp(firebaseConfig, 'criar-conta-' + Date.now());
  try {
    const cred = await createUserWithEmailAndPassword(getAuth(secondary), email, password);
    return cred.user.uid;
  } finally {
    await deleteApp(secondary);
  }
}
