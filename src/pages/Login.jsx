import { useMemo, useState } from "react";
import { auth, googleProvider } from "../firebase";
import {
  browserLocalPersistence,
  browserSessionPersistence,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
} from "firebase/auth";
import { Mail, Lock, Eye, EyeOff, Loader2 } from "lucide-react";
import "../styles/login.css";

export default function Login() {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loadingEmail, setLoadingEmail] = useState(false);
  const [loadingGoogle, setLoadingGoogle] = useState(false);
  const [manterSessao, setManterSessao] = useState(false);
  const [systemLoading, setSystemLoading] = useState(false);

  const isBusy = loadingEmail || loadingGoogle || systemLoading;
  const emailNormalizado = useMemo(() => email.trim().toLowerCase(), [email]);

  function limparErro() {
    if (erro) setErro("");
  }

  function validarFormulario() {
    if (!emailNormalizado) {
      setErro("Informe o e-mail institucional.");
      return false;
    }

    if (!/\S+@\S+\.\S+/.test(emailNormalizado)) {
      setErro("Informe um e-mail válido.");
      return false;
    }

    if (!senha) {
      setErro("Informe a senha.");
      return false;
    }

    if (senha.length < 6) {
      setErro("A senha deve possuir ao menos 6 caracteres.");
      return false;
    }

    return true;
  }

  async function aplicarPersistencia() {
    await setPersistence(
      auth,
      manterSessao ? browserLocalPersistence : browserSessionPersistence
    );
  }

  function esperar(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function mostrarCarregamentoSistema() {
    setSystemLoading(true);
    await esperar(2000);
  }

  async function loginEmail(e) {
    e.preventDefault();
    setErro("");

    if (!validarFormulario()) return;

    setLoadingEmail(true);

    try {
      await aplicarPersistencia();
      await signInWithEmailAndPassword(auth, emailNormalizado, senha);

      setLoadingEmail(false);
      await mostrarCarregamentoSistema();
    } catch (e) {
      console.error(e);
      setErro("E-mail ou senha inválidos.");
      setLoadingEmail(false);
      setSystemLoading(false);
    }
  }

  async function loginGoogle() {
    setErro("");
    setLoadingGoogle(true);

    try {
      await aplicarPersistencia();
      await signInWithPopup(auth, googleProvider);

      setLoadingGoogle(false);
      await mostrarCarregamentoSistema();
    } catch (e) {
      console.error(e);
      setErro("Não foi possível autenticar com Google no momento.");
      setLoadingGoogle(false);
      setSystemLoading(false);
    }
  }

  return (
    <div className="loginPage">
      {systemLoading && (
        <div className="systemLoadingOverlay" aria-live="polite" aria-busy="true">
          <div className="systemLoadingCard">
            <img
              src="/logo-aio.png"
              alt="Logo AIO"
              className="systemLoadingLogo"
            />

            <div className="systemLoadingSpinner">
              <Loader2 size={26} className="spin" />
            </div>

            <h3>Carregando sistema</h3>
            <p>Aguarde um instante...</p>

            <div className="systemLoadingDots" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          </div>
        </div>
      )}

      <header className="loginHeaderBar">
        Assessoria de Integração Operacional - AIO
      </header>

      <section className="loginVisualPanel" aria-hidden="true">
        <div className="loginVisualContent">
          <img
            src="/logo-aio.png"
            alt="Assessoria de Integração Operacional"
            className="loginVisualLogo"
          />

          <h1>Mapoteca de Operações</h1>

          <p>
            Plataforma para gestão e acompanhamento de dados operacionais.
            <br />
            Acesse utilizando suas credenciais.
          </p>
        </div>
      </section>

      <section className="loginFormPanel" aria-label="Acesso ao sistema">
        <div className="loginFormBox">
          <h2>Acesso</h2>
          <span className="loginFormSub">
            Informe seus dados para continuar
          </span>

          <form onSubmit={loginEmail} className="loginForm" noValidate>
            <div className="field">
              <label htmlFor="email">Login</label>

              <div className="inputGroup">
                <Mail size={18} className="inputIcon" />

                <input
                  id="email"
                  type="email"
                  placeholder="Usuário"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    limparErro();
                  }}
                  autoComplete="username"
                  disabled={isBusy}
                  className="inputControl"
                />
              </div>
            </div>

            <div className="field">
              <label htmlFor="senha">Senha</label>

              <div className="inputGroup">
                <Lock size={18} className="inputIcon" />

                <input
                  id="senha"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={senha}
                  onChange={(e) => {
                    setSenha(e.target.value);
                    limparErro();
                  }}
                  autoComplete="current-password"
                  disabled={isBusy}
                  className="inputControl"
                />

                <button
                  type="button"
                  className="passwordToggle"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                  disabled={isBusy}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <div className="actionsRow">
              <label className="keepConnected">
                <input
                  type="checkbox"
                  checked={manterSessao}
                  onChange={(e) => setManterSessao(e.target.checked)}
                  disabled={isBusy}
                />
                <span>Manter sessão</span>
              </label>
            </div>

            <button
              className="submitBtn"
              type="submit"
              disabled={isBusy}
              aria-busy={loadingEmail}
            >
              {loadingEmail ? (
                <>
                  <Loader2 size={18} className="spin" />
                  <span>Entrando...</span>
                </>
              ) : (
                <span>Entrar</span>
              )}
            </button>

            <div className="divider">
              <span>ou</span>
            </div>

            <button
              className="googleBtn"
              type="button"
              onClick={loginGoogle}
              disabled={isBusy}
              aria-busy={loadingGoogle}
            >
              {loadingGoogle ? (
                <>
                  <Loader2 size={18} className="spin" />
                  <span>Conectando...</span>
                </>
              ) : (
                <>
                  <span className="googleIcon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="18" height="18">
                      <path
                        fill="#EA4335"
                        d="M12 10.2v3.9h5.4c-.2 1.3-1.5 3.9-5.4 3.9-3.2 0-5.9-2.7-5.9-6s2.7-6 5.9-6c1.8 0 3 .8 3.7 1.5l2.5-2.4C16.6 3.6 14.5 2.7 12 2.7 6.9 2.7 2.8 6.8 2.8 12s4.1 9.3 9.2 9.3c5.3 0 8.8-3.7 8.8-8.9 0-.6-.1-1.1-.2-1.5H12z"
                      />
                      <path
                        fill="#34A853"
                        d="M3.9 7.4l3.2 2.3C7.9 8 9.8 6.7 12 6.7c1.8 0 3 .8 3.7 1.5l2.5-2.4C16.6 3.6 14.5 2.7 12 2.7c-3.5 0-6.6 2-8.1 4.7z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M12 21.3c2.4 0 4.5-.8 6-2.2l-2.8-2.3c-.8.6-1.8 1-3.2 1-3.8 0-5.1-2.6-5.4-3.8l-3.2 2.5c1.5 2.8 4.6 4.8 8.6 4.8z"
                      />
                      <path
                        fill="#4285F4"
                        d="M21 12c0-.6-.1-1.1-.2-1.5H12v3.9h5.4c-.3 1.2-1.1 2.1-2.2 2.8l2.8 2.3c1.6-1.5 3-3.9 3-7.5z"
                      />
                    </svg>
                  </span>
                  <span>Entrar com Google</span>
                </>
              )}
            </button>
          </form>

          {erro && (
            <div className="errorBox" role="alert" aria-live="polite">
              {erro}
            </div>
          )}

          <div className="footerLogin">
            ©2025 Assessoria de Integração Operacional - AIO/PMAM
          </div>
        </div>
      </section>
    </div>
  );
}