import React,{useState} from 'react';
import {Navigate,useNavigate} from 'react-router-dom';
import {useAuth} from '../../AuthContext';
import Icon from '../../components/ui/Icon';
import './auth.css';

export default function LoginPage(){
 const {user,login}=useAuth(); const navigate=useNavigate();
 const [username,setUsername]=useState(''); const [password,setPassword]=useState(''); const [show,setShow]=useState(false); const [error,setError]=useState(''); const [loading,setLoading]=useState(false);
 if(user) return <Navigate to="/" replace/>;
 async function submit(e){e.preventDefault();setLoading(true);setError('');try{const data=await login(username,password);navigate(data.mustChangePassword?'/cambiar-contrasena':'/',{replace:true});}catch(err){setError(err.message);}finally{setLoading(false)}}
 return <main className="login-screen"><div className="login-glow"/><section className="login-wrap">
  <div className="login-brand"><div className="login-logo"><Icon>description</Icon></div><h1>DMS Boletas</h1></div>
  <div className="login-card"><div><h2>Bienvenido</h2><p>Inicia sesión para continuar con tus operaciones.</p></div>
   <form onSubmit={submit} className="stack">
    <div className="field"><label htmlFor="username">Usuario o correo</label><div className="input-icon"><Icon>person</Icon><input id="username" value={username} onChange={e=>setUsername(e.target.value)} placeholder="nombre@empresa.com" required/></div></div>
    <div className="field"><label htmlFor="password">Contraseña</label><div className="input-icon"><Icon>lock</Icon><input id="password" type={show?'text':'password'} value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••" required/><button type="button" className="icon-btn" onClick={()=>setShow(v=>!v)}><Icon>{show?'visibility_off':'visibility'}</Icon></button></div></div>
    {error&&<div className="error">{error}</div>}
    <button className="btn btn-primary login-submit" disabled={loading}>{loading?<Icon>progress_activity</Icon>:<>Ingresar <Icon>login</Icon></>}</button>
   </form>
  </div><footer>DMS Boletas v2.1 · Conexión segura SSL</footer>
 </section></main>
}