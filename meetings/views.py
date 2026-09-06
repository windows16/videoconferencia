from django.shortcuts import render, redirect, get_object_or_404
from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.decorators import login_required
from django.contrib.auth.models import User
from django.http import JsonResponse, HttpResponseBadRequest
from django.views.decorators.http import require_POST, require_GET
from django.utils import timezone
from django.conf import settings
import datetime
import json

from .models import (
    Meeting, ConnectionRequest, CallContact, ChatMessage,
    RoomParticipant, generate_meeting_code
)
from .forms import LoginForm, RegisterForm, ScheduleMeetingForm
from .vpn_service import check_vpn_connectivity

# ==========================================
# Vistas de Autenticación
# ==========================================

def login_view(request):
    if request.user.is_authenticated:
        return redirect('dashboard')
    
    form = LoginForm(request.POST or None)
    error_message = None
    
    if request.method == 'POST' and form.is_valid():
        username = form.cleaned_data['username']
        password = form.cleaned_data['password']
        
        # Intentar autenticar por username o por email
        user = authenticate(request, username=username, password=password)
        if not user:
            try:
                user_obj = User.objects.get(email=username)
                user = authenticate(request, username=user_obj.username, password=password)
            except User.DoesNotExist:
                user = None
                
        if user is not None:
            login(request, user)
            next_url = request.GET.get('next') or 'dashboard'
            return redirect(next_url)
        else:
            error_message = 'Usuario o contraseña incorrectos. Verifica tus credenciales.'
            
    return render(request, 'auth/login.html', {
        'form': form,
        'error_message': error_message
    })

def register_view(request):
    if request.user.is_authenticated:
        return redirect('dashboard')
        
    form = RegisterForm(request.POST or None)
    if request.method == 'POST' and form.is_valid():
        user = form.save(commit=False)
        user.set_password(form.cleaned_data['password'])
        user.save()
        
        # Crear algunos contactos de muestra para la pestaña de llamadas
        CallContact.objects.create(
            owner=user,
            name='Ing. Telecomunicaciones',
            email='soporte.telecom@umg.edu.gt',
            status='Disponible',
            avatar_color='#1a73e8'
        )
        CallContact.objects.create(
            owner=user,
            name='Administrador VPN',
            email='vpn-admin@telecom.internal',
            status='En línea',
            avatar_color='#0d652d'
        )
        
        login(request, user)
        return redirect('dashboard')
        
    return render(request, 'auth/register.html', {'form': form})

def logout_view(request):
    logout(request)
    return redirect('login')


# ==========================================
# Vistas Principales (Google Meet UI)
# ==========================================

@login_required
def dashboard_view(request):
    """
    Vista principal de Reuniones (Imagen 1 de referencia).
    Incluye selector semanal interactivo, listado de reuniones o estado vacío,
    y accesos rápidos para unirse o iniciar reunión.
    """
    today = datetime.date.today()
    
    # Manejo de fecha seleccionada
    date_str = request.GET.get('date')
    if date_str:
        try:
            selected_date = datetime.datetime.strptime(date_str, '%Y-%m-%d').date()
        except ValueError:
            selected_date = today
    else:
        selected_date = today

    # Calcular los 7 días alrededor de la fecha seleccionada (o semana actual de lunes a domingo)
    weekday_idx = selected_date.weekday() # 0 = Lunes, 6 = Domingo
    start_of_week = selected_date - datetime.timedelta(days=weekday_idx)
    
    dias_nombres = ['LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB', 'DOM']
    dias_semana_completos = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']
    meses_nombres = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic']
    
    week_days = []
    for i in range(7):
        current_day = start_of_week + datetime.timedelta(days=i)
        week_days.append({
            'day_code': dias_nombres[i],
            'day_number': current_day.day,
            'date_str': current_day.strftime('%Y-%m-%d'),
            'is_selected': (current_day == selected_date),
            'is_today': (current_day == today),
        })
        
    # Formato de texto para la cabecera: "jue, 3 sept"
    formatted_selected_date = f"{dias_nombres[selected_date.weekday()].lower()}, {selected_date.day} {meses_nombres[selected_date.month - 1]}"
    
    # Reuniones para la fecha seleccionada
    meetings = Meeting.objects.filter(
        host=request.user,
        scheduled_date=selected_date,
        is_active=True
    ).order_by('start_time')
    
    schedule_form = ScheduleMeetingForm(initial={
        'scheduled_date': selected_date,
        'start_time': '10:00',
        'end_time': '11:00',
        'requires_vpn': True
    })
    
    prev_week_date = (start_of_week - datetime.timedelta(days=7)).strftime('%Y-%m-%d')
    next_week_date = (start_of_week + datetime.timedelta(days=7)).strftime('%Y-%m-%d')

    return render(request, 'meetings/dashboard.html', {
        'selected_date': selected_date,
        'selected_date_str': selected_date.strftime('%Y-%m-%d'),
        'formatted_selected_date': formatted_selected_date,
        'week_days': week_days,
        'prev_week_date': prev_week_date,
        'next_week_date': next_week_date,
        'meetings': meetings,
        'has_meetings': meetings.exists(),
        'schedule_form': schedule_form,
        'active_tab': 'reuniones'
    })

@login_required
def calls_view(request):
    """Vista para la pestaña 'Llamadas' (directorio de contactos y llamadas 1 a 1)."""
    contacts = CallContact.objects.filter(owner=request.user)
    return render(request, 'meetings/calls.html', {
        'contacts': contacts,
        'active_tab': 'llamadas'
    })


# ==========================================
# Vistas de Sala y Videoconferencia
# ==========================================

@login_required
def prejoin_view(request, code):
    """
    Sala de preparación (Lobby / Pre-join) antes de entrar a la videoconferencia.
    Permite probar cámara, micrófono, revisar la VPN y unirse.
    """
    meeting = get_object_or_404(Meeting, code=code)
    is_host = (request.user == meeting.host)
    vpn_status = check_vpn_connectivity(request)
    
    return render(request, 'meetings/prejoin.html', {
        'meeting': meeting,
        'is_host': is_host,
        'vpn_status': vpn_status
    })

@login_required
def room_view(request, code):
    """
    Sala de videoconferencia activa estilo Google Meet con:
    - Cuadrícula de video
    - Barra inferior de controles (micrófono, cámara, pantalla, finalizar)
    - Panel de admisión de conexiones / sala de espera para el anfitrión
    - Panel de configuración de periféricos (Audio y Video)
    """
    meeting = get_object_or_404(Meeting, code=code)
    is_host = (request.user == meeting.host)
    vpn_status = check_vpn_connectivity(request)
    
    # Si no es el anfitrión, verificar si su conexión ya fue aceptada
    user_status = 'ACCEPTED' if is_host else 'PENDING'
    if not is_host:
        conn_req, created = ConnectionRequest.objects.get_or_create(
            meeting=meeting,
            user=request.user,
            defaults={'participant_name': request.user.get_full_name() or request.user.username}
        )
        user_status = conn_req.status

    return render(request, 'meetings/room.html', {
        'meeting': meeting,
        'is_host': is_host,
        'user_status': user_status,
        'vpn_status': vpn_status
    })


# ==========================================
# Endpoints API REST (JSON)
# ==========================================

@login_required
@require_POST
def api_create_instant_meeting(request):
    """Crea una reunión instantánea e inmediatamente retorna el código y URL de acceso."""
    today = datetime.date.today()
    now = datetime.datetime.now().time()
    later = (datetime.datetime.now() + datetime.timedelta(hours=1)).time()
    
    code = generate_meeting_code()
    meeting = Meeting.objects.create(
        title=f"Reunión instantánea de {request.user.first_name or request.user.username}",
        code=code,
        host=request.user,
        scheduled_date=today,
        start_time=now,
        end_time=later,
        is_instant=True,
        requires_vpn=True
    )
    
    return JsonResponse({
        'success': True,
        'code': meeting.code,
        'join_url': f"/room/{meeting.code}/",
        'prejoin_url': f"/prejoin/{meeting.code}/"
    })

@login_required
@require_POST
def api_schedule_meeting(request):
    """Procesa el formulario modal para programar una reunión en el calendario."""
    form = ScheduleMeetingForm(request.POST)
    if form.is_valid():
        meeting = form.save(commit=False)
        meeting.host = request.user
        meeting.code = generate_meeting_code()
        meeting.save()
        return JsonResponse({
            'success': True,
            'message': 'Reunión programada exitosamente.',
            'code': meeting.code,
            'scheduled_date': meeting.scheduled_date.strftime('%Y-%m-%d')
        })
    else:
        return JsonResponse({
            'success': False,
            'errors': form.errors
        }, status=400)

@login_required
@require_GET
def api_check_meeting(request):
    """Verifica si un código de reunión ingresado en el buscador existe."""
    code = request.GET.get('code', '').strip().lower()
    # Eliminar posibles URLs completas si el usuario pegó el enlace
    if '/' in code:
        code = code.split('/')[-1]
        
    try:
        meeting = Meeting.objects.get(code=code, is_active=True)
        return JsonResponse({
            'exists': True,
            'code': meeting.code,
            'title': meeting.title,
            'host': meeting.host.get_full_name() or meeting.host.username,
            'join_url': f"/prejoin/{meeting.code}/"
        })
    except Meeting.DoesNotExist:
        return JsonResponse({
            'exists': False,
            'message': 'No se encontró ninguna reunión con ese código.'
        })

@login_required
@require_GET
def api_waiting_room_status(request, code):
    """
    Consultado por el participante en sala de espera para verificar si el anfitrión lo admitió.
    """
    meeting = get_object_or_404(Meeting, code=code)
    try:
        conn_req = ConnectionRequest.objects.get(meeting=meeting, user=request.user)
        return JsonResponse({
            'status': conn_req.status,
            'is_accepted': conn_req.status == 'ACCEPTED',
            'is_rejected': conn_req.status == 'REJECTED'
        })
    except ConnectionRequest.DoesNotExist:
        return JsonResponse({'status': 'PENDING', 'is_accepted': False, 'is_rejected': False})

@login_required
@require_GET
def api_host_pending_requests(request, code):
    """
    Consultado periódicamente por el anfitrión para recibir solicitudes pendientes de admisión.
    """
    meeting = get_object_or_404(Meeting, code=code)
    if meeting.host != request.user:
        return JsonResponse({'error': 'No autorizado'}, status=403)
        
    pending = ConnectionRequest.objects.filter(meeting=meeting, status='PENDING')
    data = [
        {
            'id': req.id,
            'name': req.participant_name,
            'requested_at': req.requested_at.strftime('%H:%M:%S')
        }
        for req in pending
    ]
    return JsonResponse({'requests': data})

@login_required
@require_POST
def api_host_action_request(request, code):
    """
    Acción del anfitrión para 'Permitir' o 'Denegar' la conexión de un participante.
    """
    meeting = get_object_or_404(Meeting, code=code)
    if meeting.host != request.user:
        return JsonResponse({'error': 'No autorizado'}, status=403)
        
    try:
        body = json.loads(request.body)
        request_id = body.get('request_id')
        action = body.get('action') # 'accept' o 'reject'
        
        conn_req = ConnectionRequest.objects.get(id=request_id, meeting=meeting)
        if action == 'accept':
            conn_req.status = 'ACCEPTED'
        elif action == 'reject':
            conn_req.status = 'REJECTED'
        conn_req.decided_at = timezone.now()
        conn_req.save()
        
        return JsonResponse({'success': True, 'status': conn_req.status})
    except (ConnectionRequest.DoesNotExist, json.JSONDecodeError, KeyError):
        return JsonResponse({'error': 'Petición inválida'}, status=400)

@login_required
@require_GET
def api_vpn_status(request):
    """Devuelve las métricas actuales de seguridad y estado de la VPN hacia el servidor."""
    status_data = check_vpn_connectivity(request)
    return JsonResponse(status_data)

# ==========================================
# Endpoints de Chat y Señalización en Tiempo Real
# ==========================================

@login_required
def api_meeting_messages(request, code):
    """Obtiene o envía mensajes de chat en la sala de videoconferencia."""
    meeting = get_object_or_404(Meeting, code=code)

    if request.method == 'POST':
        try:
            body = json.loads(request.body)
            msg_text = body.get('message', '').strip()
            if not msg_text:
                return JsonResponse({'error': 'Mensaje vacío'}, status=400)

            sender_name = request.user.get_full_name() or request.user.username
            msg = ChatMessage.objects.create(
                meeting=meeting,
                user=request.user,
                sender_name=sender_name,
                message=msg_text
            )
            return JsonResponse({
                'success': True,
                'message': {
                    'id': msg.id,
                    'user_id': request.user.id,
                    'sender_name': msg.sender_name,
                    'message': msg.message,
                    'time': msg.created_at.strftime('%H:%M'),
                    'is_me': True
                }
            })
        except Exception as e:
            return JsonResponse({'error': str(e)}, status=400)

    # GET: devolver mensajes
    after_id = request.GET.get('after_id')
    messages_qs = meeting.chat_messages.all()
    if after_id:
        try:
            messages_qs = messages_qs.filter(id__gt=int(after_id))
        except ValueError:
            pass

    data = [
        {
            'id': m.id,
            'user_id': m.user_id,
            'sender_name': m.sender_name,
            'message': m.message,
            'time': m.created_at.strftime('%H:%M'),
            'is_me': (m.user_id == request.user.id)
        }
        for m in messages_qs[:100]
    ]
    return JsonResponse({'messages': data})


@login_required
@require_POST
def api_room_heartbeat(request, code):
    """
    Registra/actualiza la presencia en vivo del participante en la sala y devuelve
    la lista de todos los pares activos (para conectarse automáticamente vía WebRTC).
    """
    meeting = get_object_or_404(Meeting, code=code)
    try:
        body = json.loads(request.body) if request.body else {}
        peer_id = body.get('peer_id', '').strip()
        is_audio_muted = body.get('is_audio_muted', False)
        is_video_muted = body.get('is_video_muted', False)
        is_hand_raised = body.get('is_hand_raised', False)
        display_name = request.user.get_full_name() or request.user.username
        is_host = (meeting.host == request.user)

        # Actualizar o crear registro de presencia
        participant, _ = RoomParticipant.objects.update_or_create(
            meeting=meeting,
            user=request.user,
            defaults={
                'peer_id': peer_id or f"user-{request.user.id}",
                'display_name': display_name,
                'is_host': is_host,
                'is_audio_muted': is_audio_muted,
                'is_video_muted': is_video_muted,
                'is_hand_raised': is_hand_raised,
                'last_seen': timezone.now()
            }
        )

        # Considerar participantes activos en los últimos 20 segundos
        threshold = timezone.now() - datetime.timedelta(seconds=20)
        active_qs = RoomParticipant.objects.filter(meeting=meeting, last_seen__gte=threshold)

        participants_list = [
            {
                'user_id': p.user_id,
                'peer_id': p.peer_id,
                'display_name': p.display_name,
                'is_host': p.is_host,
                'is_audio_muted': p.is_audio_muted,
                'is_video_muted': p.is_video_muted,
                'is_hand_raised': p.is_hand_raised,
                'is_me': (p.user_id == request.user.id)
            }
            for p in active_qs
        ]

        return JsonResponse({
            'success': True,
            'participants': participants_list,
            'count': len(participants_list)
        })
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=400)


@login_required
@require_POST
def api_leave_room(request, code):
    """Elimina el registro de presencia cuando el usuario sale de la llamada."""
    meeting = get_object_or_404(Meeting, code=code)
    RoomParticipant.objects.filter(meeting=meeting, user=request.user).delete()
    return JsonResponse({'success': True})

