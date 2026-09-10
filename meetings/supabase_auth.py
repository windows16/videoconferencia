"""
Supabase Authentication Service for TeleConnect (usando cliente oficial supabase-py).
"""
import os
from django.conf import settings
from django.contrib.auth.models import User
from supabase import create_client, Client


def get_supabase_config():
    """Obtiene la URL y anon key de Supabase desde settings o variables de entorno."""
    url = getattr(settings, 'SUPABASE_URL', '') or os.environ.get('SUPABASE_URL', '')
    anon_key = getattr(settings, 'SUPABASE_ANON_KEY', '') or os.environ.get('SUPABASE_ANON_KEY', '')
    return url.strip().rstrip('/'), anon_key.strip()


def is_supabase_enabled():
    """Verifica si Supabase está configurado."""
    url, anon_key = get_supabase_config()
    return bool(url and anon_key)


def get_supabase_client() -> Client:
    """Instancia el cliente oficial de Supabase."""
    url, anon_key = get_supabase_config()
    if not (url and anon_key):
        return None
    return create_client(url, anon_key)


def supabase_sign_up(email, password, user_metadata=None):
    """
    Registra un usuario en Supabase usando el cliente oficial.
    Retorna: (data_dict, error_string)
    """
    client = get_supabase_client()
    if not client:
        return None, "Supabase no está configurado (falta SUPABASE_URL o SUPABASE_ANON_KEY)."

    try:
        credentials = {
            "email": email,
            "password": password,
        }
        if user_metadata:
            credentials["options"] = {"data": user_metadata}
        
        res = client.auth.sign_up(credentials)
        if res and res.user:
            return {
                "user": res.user,
                "session": res.session,
                "id": str(res.user.id)
            }, None
        return None, "No se pudo completar el registro en Supabase."
    except Exception as e:
        msg = str(e)
        # Limpiar mensaje si contiene detalles técnicos
        if "Email rate limit exceeded" in msg:
            msg = "Límite de correos alcanzado en Supabase. Intenta más tarde."
        elif "User already registered" in msg:
            msg = "El correo ya está registrado en Supabase."
        elif "Password should be at least" in msg:
            msg = "La contraseña debe tener al menos 6 caracteres."
        return None, msg


def supabase_sign_in(email, password):
    """
    Inicia sesión con correo y contraseña usando el cliente oficial de Supabase.
    Retorna: (data_dict, error_string)
    """
    client = get_supabase_client()
    if not client:
        return None, "Supabase no está configurado (falta SUPABASE_URL o SUPABASE_ANON_KEY)."

    try:
        res = client.auth.sign_in_with_password({
            "email": email,
            "password": password
        })
        if res and res.user:
            access_token = res.session.access_token if res.session else None
            refresh_token = res.session.refresh_token if res.session else None
            user_metadata = getattr(res.user, 'user_metadata', {}) or {}
            
            return {
                "access_token": access_token,
                "refresh_token": refresh_token,
                "user": {
                    "id": str(res.user.id),
                    "email": res.user.email,
                    "user_metadata": user_metadata
                }
            }, None
        return None, "Credenciales inválidas en Supabase."
    except Exception as e:
        msg = str(e)
        if "Invalid login credentials" in msg:
            msg = "Correo o contraseña incorrectos en Supabase."
        elif "Email not confirmed" in msg:
            msg = "El correo electrónico no ha sido confirmado en Supabase."
        return None, msg


def supabase_sign_out(access_token=None):
    """Cierra la sesión usando el cliente de Supabase."""
    client = get_supabase_client()
    if not client:
        return
    try:
        client.auth.sign_out()
    except Exception:
        pass


def sync_supabase_user_to_django(email, first_name='', last_name='', username=None, supabase_id=None):
    """
    Crea o actualiza el usuario local de Django para mantener la sesión activa
    y compatibilidad con las reuniones, chat y permisos.
    """
    if not username:
        username = email.split('@')[0]

    base_username = username
    counter = 1
    while True:
        existing = User.objects.filter(username=username).first()
        if not existing or existing.email == email:
            break
        username = f"{base_username}_{counter}"
        counter += 1

    user, created = User.objects.get_or_create(
        email=email,
        defaults={
            'username': username,
            'first_name': first_name or '',
            'last_name': last_name or '',
        }
    )

    updated = False
    if first_name and user.first_name != first_name:
        user.first_name = first_name
        updated = True
    if last_name and user.last_name != last_name:
        user.last_name = last_name
        updated = True
    if updated:
        user.save()

    return user
