from django.db import models
from django.contrib.auth.models import User
import string
import random
import uuid

def generate_meeting_code():
    """Genera un código de reunión estilo Google Meet: xxx-yyyy-zzz."""
    def r_letters(n):
        return ''.join(random.choices(string.ascii_lowercase, k=n))
    return f"{r_letters(3)}-{r_letters(4)}-{r_letters(3)}"

class Meeting(models.Model):
    """Modelo para sesiones de videoconferencia."""
    title = models.CharField(max_length=200, default='Reunión de videollamada')
    code = models.CharField(max_length=20, unique=True, default=generate_meeting_code, db_index=True)
    host = models.ForeignKey(User, on_delete=models.CASCADE, related_name='hosted_meetings')
    description = models.TextField(blank=True, null=True)
    scheduled_date = models.DateField()
    start_time = models.TimeField()
    end_time = models.TimeField()
    is_instant = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    requires_vpn = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['scheduled_date', 'start_time']
        verbose_name = 'Reunión'
        verbose_name_plural = 'Reuniones'

    def __str__(self):
        return f"{self.title} ({self.code}) - {self.scheduled_date}"

    @property
    def formatted_time(self):
        return f"{self.start_time.strftime('%H:%M')} - {self.end_time.strftime('%H:%M')}"

class ConnectionRequest(models.Model):
    """
    Solicitudes de admisión a la reunión (Sala de espera / Aceptar conexiones).
    El anfitrión puede permitir o denegar la conexión.
    """
    STATUS_CHOICES = [
        ('PENDING', 'Pendiente'),
        ('ACCEPTED', 'Aceptada'),
        ('REJECTED', 'Rechazada'),
    ]

    meeting = models.ForeignKey(Meeting, on_delete=models.CASCADE, related_name='connection_requests')
    user = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True)
    participant_name = models.CharField(max_length=120)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='PENDING')
    is_audio_muted = models.BooleanField(default=False)
    is_video_muted = models.BooleanField(default=False)
    requested_at = models.DateTimeField(auto_now_add=True)
    decided_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['requested_at']
        verbose_name = 'Solicitud de Conexión'
        verbose_name_plural = 'Solicitudes de Conexión'

    def __str__(self):
        return f"{self.participant_name} -> {self.meeting.code} ({self.status})"

class CallContact(models.Model):
    """Contactos y llamadas directas para la pestaña 'Llamadas'."""
    owner = models.ForeignKey(User, on_delete=models.CASCADE, related_name='contacts')
    name = models.CharField(max_length=120)
    email = models.EmailField()
    avatar_color = models.CharField(max_length=10, default='#1a73e8')
    status = models.CharField(max_length=30, default='Disponible')
    last_call = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = 'Contacto de Llamadas'
        verbose_name_plural = 'Contactos de Llamadas'

    def __str__(self):
        return f"{self.name} ({self.email})"


class ChatMessage(models.Model):
    """Mensajes de chat intercambiados dentro de una sala de videoconferencia."""
    meeting = models.ForeignKey(Meeting, on_delete=models.CASCADE, related_name='chat_messages')
    user = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True)
    sender_name = models.CharField(max_length=120)
    message = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at']
        verbose_name = 'Mensaje de Chat'
        verbose_name_plural = 'Mensajes de Chat'

    def __str__(self):
        return f"[{self.meeting.code}] {self.sender_name}: {self.message[:30]}"


class RoomParticipant(models.Model):
    """Participantes activos actualmente en la sala (rastreo de presencia en vivo)."""
    meeting = models.ForeignKey(Meeting, on_delete=models.CASCADE, related_name='active_participants')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='meeting_participations')
    peer_id = models.CharField(max_length=100, blank=True, default='')
    display_name = models.CharField(max_length=120)
    is_host = models.BooleanField(default=False)
    is_audio_muted = models.BooleanField(default=False)
    is_video_muted = models.BooleanField(default=False)
    is_hand_raised = models.BooleanField(default=False)
    joined_at = models.DateTimeField(auto_now_add=True)
    last_seen = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('meeting', 'user')
        verbose_name = 'Participante de Sala'
        verbose_name_plural = 'Participantes de Sala'

    def __str__(self):
        return f"{self.display_name} en {self.meeting.code} (Peer: {self.peer_id})"

