"""
Supabase Authentication Service for TeleConnect.
Provee integración completa con la API REST de Supabase Auth (GoTrue),
sincronizando los usuarios autenticados con los modelos de Django.
"""
import os
import requests
from django.conf import settings
from django.contrib.auth.models import User


def get_supabase_config():
    """Obtiene la configuración de Supabase desde settings o variables de entorno."""
    url = getattr(settings, 'SUPABASE_URL', '') or os.environ.get('SUPABASE_URL', '')
    anon_key = getattr(settings, 'SUPABASE_ANON_KEY', '') or os.environ.get('SUPABASE_ANON_KEY', '')
    url = url.strip().rstrip('/')
    anon_key = anon_key.strip()
    return url, anon_key


def is_supabase_enabled():
    """Verifica si Supabase está configurado con URL y anon_key válidas."""
    url, anon_key = get_supabase_config()
    return bool(url and anon_key)


def get_supabase_headers(access_token=None):
    """Genera las cabeceras HTTP necesarias para llamar a Supabase Auth."""
    url, anon_key = get_supabase_config()
    headers = {
        'apikey': anon_key,
        'Content-Type': 'application/json',
    }
    if access_token:
        headers['Authorization'] = f'Bearer {access_token}'
    else:
        headers['Authorization'] = f'Bearer {anon_key}'
    return headers


def supabase_sign_up(email, password, user_metadata=None):
    """
    Registra un nuevo usuario en Supabase Auth.
    Retorna: (data_dict, error_string)
    """
    url, anon_key = get_supabase_config()
    if not is_supabase_enabled():
        return None, "Supabase no está configurado (falta SUPABASE_URL o SUPABASE_ANON_KEY)."

    endpoint = f"{url}/auth/v1/signup"
    payload = {
        'email': email,
        'password': password,
    }
    if user_metadata:
        payload['data'] = user_metadata

    try:
        response = requests.post(
            endpoint,
            headers=get_supabase_headers(),
            json=payload,
            timeout=10
        )
        data = response.json()
        if response.status_code in (200, 201):
            return data, None
        else:
            error_msg = data.get('msg') or data.get('error_description') or data.get('message') or str(data)
            return None, error_msg
    except Exception as e:
        return None, f"Error de conexión con Supabase: {str(e)}"


def supabase_sign_in(email, password):
    """
    Inicia sesión de un usuario con correo y contraseña en Supabase Auth.
    Retorna: (data_dict, error_string)
    data_dict contendrá: access_token, refresh_token, user: {id, email, user_metadata...}
    """
    url, anon_key = get_supabase_config()
    if not is_supabase_enabled():
        return None, "Supabase no está configurado (falta SUPABASE_URL o SUPABASE_ANON_KEY)."

    endpoint = f"{url}/auth/v1/token?grant_type=password"
    payload = {
        'email': email,
        'password': password,
    }

    try:
        response = requests.post(
            endpoint,
            headers=get_supabase_headers(),
            json=payload,
            timeout=10
        )
        data = response.json()
        if response.status_code == 200:
            return data, None
        else:
            error_msg = data.get('error_description') or data.get('msg') or data.get('message') or 'Credenciales inválidas en Supabase.'
            return None, error_msg
    except Exception as e:
        return None, f"Error de conexión con Supabase: {str(e)}"


def supabase_sign_out(access_token):
    """Cierra la sesión del token en Supabase Auth."""
    url, anon_key = get_supabase_config()
    if not is_supabase_enabled() or not access_token:
        return

    endpoint = f"{url}/auth/v1/logout"
    try:
        requests.post(
            endpoint,
            headers=get_supabase_headers(access_token=access_token),
            timeout=5
        )
    except Exception:
        pass


def sync_supabase_user_to_django(email, first_name='', last_name='', username=None, supabase_id=None):
    """
    Garantiza que exista un usuario local en Django para la sesión actual,
    sincronizando los datos recibidos de Supabase.
    """
    if not username:
        username = email.split('@')[0]

    # Asegurar username único
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

    # Actualizar nombres si vienen en los metadatos de Supabase
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
