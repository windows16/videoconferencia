from django.urls import path
from . import views

urlpatterns = [
    # Navegación principal
    path('', views.dashboard_view, name='dashboard'),
    path('calls/', views.calls_view, name='calls'),
    
    # Autenticación
    path('login/', views.login_view, name='login'),
    path('register/', views.register_view, name='register'),
    path('logout/', views.logout_view, name='logout'),
    
    # Sala de videoconferencia y Lobby
    path('prejoin/<str:code>/', views.prejoin_view, name='prejoin'),
    path('room/<str:code>/', views.room_view, name='room'),
    
    # Endpoints API REST
    path('api/meetings/instant/', views.api_create_instant_meeting, name='api_instant'),
    path('api/meetings/schedule/', views.api_schedule_meeting, name='api_schedule'),
    path('api/meetings/check/', views.api_check_meeting, name='api_check'),
    path('api/waiting-room/<str:code>/status/', views.api_waiting_room_status, name='api_waiting_status'),
    path('api/waiting-room/<str:code>/pending/', views.api_host_pending_requests, name='api_host_pending'),
    path('api/waiting-room/<str:code>/action/', views.api_host_action_request, name='api_host_action'),
    path('api/vpn/status/', views.api_vpn_status, name='api_vpn_status'),
]
