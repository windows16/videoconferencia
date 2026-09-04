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
