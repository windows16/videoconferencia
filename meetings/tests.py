from django.test import TestCase, Client
from django.contrib.auth.models import User
from django.urls import reverse
import datetime

from .models import Meeting, ConnectionRequest, CallContact, generate_meeting_code
from .vpn_service import check_vpn_connectivity

class MeetingPlatformTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.user = User.objects.create_user(
            username='sara_telecom',
            first_name='Sara',
            last_name='Belloso',
            email='sara@telecom.umg.edu.gt',
            password='TestPassword123!'
        )
        self.guest = User.objects.create_user(
            username='invitado_test',
            first_name='Invitado',
            email='invitado@telecom.umg.edu.gt',
            password='TestPassword123!'
        )
        self.meeting = Meeting.objects.create(
            title='Prueba Videoconferencia Redes',
            code='abc-defg-hij',
            host=self.user,
            scheduled_date=datetime.date.today(),
            start_time=datetime.time(10, 0),
            end_time=datetime.time(11, 0),
            requires_vpn=True
        )

    def test_meeting_code_generation(self):
        """Verifica que los códigos generados tengan el formato estándar xxx-yyyy-zzz."""
        code = generate_meeting_code()
        parts = code.split('-')
        self.assertEqual(len(parts), 3)
        self.assertEqual(len(parts[0]), 3)
        self.assertEqual(len(parts[1]), 4)
        self.assertEqual(len(parts[2]), 3)

    def test_formatted_time(self):
        """Verifica el formato legible de horario de la reunión."""
        self.assertEqual(self.meeting.formatted_time, "10:00 - 11:00")

    def test_vpn_connectivity_service(self):
        """Verifica el servicio de validación de VPN y servidor seguro."""
        vpn_data = check_vpn_connectivity()
        self.assertIn('is_connected', vpn_data)
        self.assertIn('server_ip', vpn_data)
        self.assertIn('status_label', vpn_data)
        self.assertIn('badge_class', vpn_data)

    def test_waiting_room_admission_flow(self):
        """Verifica el flujo de solicitud y admisión de participante en sala de espera."""
        req = ConnectionRequest.objects.create(
            meeting=self.meeting,
            user=self.guest,
            participant_name='Invitado Especial',
            status='PENDING'
        )
        self.assertEqual(req.status, 'PENDING')
        
        # Simular anfitrión aceptando conexión
        req.status = 'ACCEPTED'
        req.save()
        self.assertEqual(ConnectionRequest.objects.get(id=req.id).status, 'ACCEPTED')

    def test_dashboard_access_authenticated(self):
        """Verifica que un usuario autenticado pueda acceder al dashboard."""
        self.client.login(username='sara_telecom', password='TestPassword123!')
        response = self.client.get(reverse('dashboard'))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'Reuniones')
        self.assertContains(response, 'Prueba Videoconferencia Redes')

    def test_chat_message_flow(self):
        """Verifica el envío y obtención de mensajes de chat en sala."""
        self.client.login(username='sara_telecom', password='TestPassword123!')
        
        # Enviar mensaje
        resp = self.client.post(
            reverse('api_room_messages', kwargs={'code': self.meeting.code}),
            data='{"message": "Hola a todos en la sesión"}',
            content_type='application/json'
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertTrue(data.get('success'))
        self.assertEqual(data['message']['message'], 'Hola a todos en la sesión')

        # Obtener mensajes
        resp_get = self.client.get(reverse('api_room_messages', kwargs={'code': self.meeting.code}))
        self.assertEqual(resp_get.status_code, 200)
        messages = resp_get.json().get('messages', [])
        self.assertEqual(len(messages), 1)
        self.assertEqual(messages[0]['message'], 'Hola a todos en la sesión')

    def test_room_heartbeat_and_presence(self):
        """Verifica el registro de presencia y lista de participantes activos."""
        self.client.login(username='sara_telecom', password='TestPassword123!')
        
        resp = self.client.post(
            reverse('api_room_heartbeat', kwargs={'code': self.meeting.code}),
            data='{"peer_id": "telemeet-test-peer-1", "is_audio_muted": false, "is_video_muted": false, "is_hand_raised": true}',
            content_type='application/json'
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertTrue(data.get('success'))
        self.assertEqual(data.get('count'), 1)
        participant = data['participants'][0]
        self.assertEqual(participant['peer_id'], 'telemeet-test-peer-1')
        self.assertTrue(participant['is_hand_raised'])

